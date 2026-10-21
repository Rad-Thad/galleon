/**
 * Who is on the other end of a core socket connection (ADR 0006).
 *
 * The kernel records the connecting process's user on a Unix socket
 * (SO_PEERCRED), but Node offers no getsockopt. The accepted socket is lent to
 * a short-lived system Python as one of its descriptors, which asks the kernel
 * and prints the user id. Nothing is read from the connection meanwhile, so a
 * client's request waits in the kernel until the answer is in.
 */

import { spawn } from 'node:child_process'
import type { Socket } from 'node:net'
import { childEnvironment } from '../childenv.ts'

/**
 * How long the helper may take before the connection is refused. A user it
 * cannot name is not the owner, so slowness fails closed like any other
 * failure.
 */
export const PEER_CHECK_TIMEOUT_MS = 5000

/** The descriptor the socket is lent on: the first after stdin, stdout and stderr. */
const SOCKET_FD = 3

const SCRIPT = [
  'import socket, struct',
  `s = socket.socket(fileno=${SOCKET_FD})`,
  'size = struct.calcsize("3i")',
  'pid, uid, gid = struct.unpack("3i", s.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, size))',
  // The descriptor is the parent's to close; detaching keeps Python from
  // shutting the connection down on its way out.
  's.detach()',
  'print(uid)'
].join('\n')

/**
 * The user id of the process that connected `client`, or null when it cannot
 * be learnt (no Python, a helper that fails or hangs, output that is not a
 * number). Never throws.
 */
export function peerUid(
  client: Socket,
  python = 'python3',
  timeoutMs = PEER_CHECK_TIMEOUT_MS
): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false
    let timer: NodeJS.Timeout | undefined
    const finish = (uid: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(uid)
    }
    let helper
    try {
      // -I and -S: no user site, no PYTHON* variables, no current folder on
      // the import path, so nothing outside the system Python runs here.
      helper = spawn(python, ['-I', '-S', '-c', SCRIPT], {
        stdio: ['ignore', 'pipe', 'ignore', client],
        env: childEnvironment(process.env)
      })
    } catch {
      finish(null)
      return
    }
    timer = setTimeout(() => {
      helper.kill('SIGKILL')
      finish(null)
    }, timeoutMs)
    let output = ''
    helper.stdout?.setEncoding('utf8')
    helper.stdout?.on('data', (chunk: string) => {
      output += chunk
    })
    helper.once('error', () => finish(null))
    helper.once('close', (code) => {
      const text = output.trim()
      finish(code === 0 && /^\d+$/.test(text) ? Number(text) : null)
    })
  })
}
