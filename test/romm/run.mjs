// `npm run test:romm`: every `*.real.ts` against each Docker RomM in turn,
// brought up and provisioned here, so one command covers every server
// version the owner's has run. See README.md.
//
//   npm run test:romm                       # 5.2.0, then 5.3.1
//   npm run test:romm -- --profile v531     # one version
//   npm run test:saves                      # test/saves/*.real.ts on 5.2.0
//
// A failing version does not stop the next: the exit code says whether any
// failed, and the log says which.
import { spawnSync } from 'node:child_process'
import { profilesFrom } from './lib.mjs'

const COMPOSE = ['compose', '-f', 'test/romm/compose.yml']

function run(command, args, env = {}) {
  const { status } = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env }
  })
  return status === 0
}

const argv = process.argv.slice(2)
const at = argv.indexOf('--suite')
const suite = at === -1 ? 'romm' : argv.splice(at, 2)[1]
if (suite !== 'romm' && suite !== 'saves') {
  console.error(`unknown suite ${suite}; one of romm, saves`)
  process.exit(1)
}
const profiles = profilesFrom(argv)
if (!run('node', ['test/romm/make-library.mjs'])) process.exit(1)

const failed = []
for (const profile of profiles) {
  // A fold per version in the Actions log, which is otherwise one long page.
  console.log(process.env.GITHUB_ACTIONS ? `::group::RomM ${profile}` : `==> RomM ${profile}`)
  const started = Date.now()
  const ok =
    run('docker', [...COMPOSE, '--profile', profile, 'up', '-d']) &&
    (run('node', ['test/romm/provision.mjs', '--profile', profile]) ||
      (run('docker', [...COMPOSE, '--profile', profile, 'logs', '--tail', '200']), false)) &&
    run('npm', ['run', `test:${suite}-real`], { ROMM_PROFILE: profile })
  console.log(
    `RomM ${profile} ${ok ? 'passed' : 'failed'} in ${Math.round((Date.now() - started) / 1000)}s`
  )
  if (process.env.GITHUB_ACTIONS) console.log('::endgroup::')
  if (!ok) failed.push(profile)
}

if (failed.length > 0) {
  console.error(`test:${suite} failed on ${failed.join(', ')}`)
  process.exit(1)
}
console.log(`test:${suite} passed on ${profiles.join(', ')}`)
