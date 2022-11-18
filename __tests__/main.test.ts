import * as wf from '../src/workflows'
// import * as process from 'process'
// import * as cp from 'child_process'
// import * as path from 'path'
import {expect, test} from '@jest/globals'

test('get workflow matching actions', async () => {
  const workflow = "actions" 
  const expected = workflow 
  const result = await wf.workflows(workflow)
  await expect(result === expected)
})

test('get workflow matching all', async () => {
  const workflow = "all" 
  const expected = workflow 
  const result = await wf.workflows(workflow)
  await expect(result === expected)
})


// // shows how the runner will run a javascript action with env / stdout protocol
// test('test runs', () => {
//   process.env['INPUT_MILLISECONDS'] = '500'
//   const np = process.execPath
//   const ip = path.join(__dirname, '..', 'lib', 'main.js')
//   const options: cp.ExecFileSyncOptions = {
//     env: process.env
//   }
//   console.log(cp.execFileSync(np, [ip], options).toString())
// })
