import assert from 'node:assert/strict'
import { test } from 'node:test'
import { editSetting } from './settingsedit.ts'
import type { SettingsEdit } from './types.ts'

const SLOT: SettingsEdit = {
  file: 'Dolphin.ini',
  section: 'Core',
  key: 'SlotA',
  value: '8',
  whenAbsent: 'leave',
  folder: undefined
}

test('changes only the value of the key, in its own section', () => {
  const text = '[General]\nSlotA = 1\n[Core]\nCPUThread = True\nSlotA = 1\n[DSP]\nSlotA = 1\n'
  assert.equal(
    editSetting(text, SLOT),
    '[General]\nSlotA = 1\n[Core]\nCPUThread = True\nSlotA = 8\n[DSP]\nSlotA = 1\n'
  )
})

test('a key already set is nothing to write', () => {
  assert.equal(editSetting('[Core]\nSlotA = 8\n', SLOT), null)
  assert.equal(editSetting('[core]\nslota=8', SLOT), null)
})

test('keeps the spacing, case and line ends the file has', () => {
  assert.equal(
    editSetting('[core]\r\nslota=1\r\nX = 2\r\n', SLOT),
    '[core]\r\nslota=8\r\nX = 2\r\n'
  )
  assert.equal(editSetting('[Core]\nSlotA =\n', SLOT), '[Core]\nSlotA = 8\n')
})

test('only the first matching key is changed, the one an INI reader takes', () => {
  assert.equal(
    editSetting('[Core]\nSlotA = 1\nSlotA = 2\n', SLOT),
    '[Core]\nSlotA = 8\nSlotA = 2\n'
  )
})

test('a missing key is left missing when the default is already the value', () => {
  assert.equal(editSetting('[Core]\nCPUThread = True\n', SLOT), null)
  assert.equal(editSetting('', SLOT), null)
})

test('a missing key is added after its section’s last setting when asked for', () => {
  const add = { ...SLOT, whenAbsent: 'add' } as const
  assert.equal(
    editSetting('[Core]\nCPUThread = True\n\n[DSP]\nVolume = 0\n', add),
    '[Core]\nCPUThread = True\nSlotA = 8\n\n[DSP]\nVolume = 0\n'
  )
  assert.equal(editSetting('[Core]\r\nA = 1\r\n', add), '[Core]\r\nA = 1\r\nSlotA = 8\r\n')
})

test('a missing section is added at the end when asked for', () => {
  const add = { ...SLOT, whenAbsent: 'add' } as const
  assert.equal(editSetting('[DSP]\nVolume = 0', add), '[DSP]\nVolume = 0\n[Core]\nSlotA = 8\n')
  assert.equal(editSetting('', add), '[Core]\nSlotA = 8\n')
})
