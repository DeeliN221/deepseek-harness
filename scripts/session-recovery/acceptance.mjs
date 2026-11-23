/** Isolated built-Web SIGKILL/restart acceptance. External model only is deterministic. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const queueCase = process.env.RECOVERY_CASE === 'queue'
const repo = resolve(import.meta.dirname, '../..')
const root = await mkdtemp(join(tmpdir(), 'dsh-session-recovery-'))
await mkdir(join(root, 'workspace'))
const home = join(root, 'home')
const fixture = join(root, 'fixture.mjs')
const llm = pathToFileURL(join(repo, 'packages/llm/llm/lib/index.js')).href
const tools = pathToFileURL(join(repo, 'packages/core/tools/lib/index.js')).href
await writeFile(fixture, `
import { LlmAdapter, LlmError } from ${JSON.stringify(llm)};
import { defineTool } from ${JSON.stringify(tools)};
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
export const name = 'recovery-acceptance-model';
export const inject = ['llm','tools','sessions'];
export function apply(ctx) {
  const effectPath = ${JSON.stringify(join(root, 'effects.txt'))};
  const checkpoint = ${JSON.stringify(join(root, 'ready-to-kill'))};
  const completed = ${JSON.stringify(join(root, 'completed.json'))};
  const tool = defineTool({name:'recovery_effect',description:'Record one completed fixture operation',parameters:{},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    execute:async()=>{appendFileSync(effectPath,'effect\\n');return 'recorded';}});
  ctx.effect(()=>ctx.tools.register(tool));
  class Adapter extends LlmAdapter {
    async listModels(provider){return [{provider,id:'fixture',name:'Recovery fixture'}];}
    async resolveModel(provider,model){return {provider,id:model,name:model};}
    async *stream(options) {
      if (!existsSync(effectPath)) {
        yield {type:'block-start',index:0,blockType:'tool-call'};
        yield {type:'tool-call-delta',index:0,id:'recovery-effect-1',name:'recovery_effect',argumentsDelta:'{}'};
        yield {type:'block-end',index:0,block:{type:'tool-call',id:'recovery-effect-1',name:'recovery_effect',arguments:'{}'}};
        yield {type:'finish',reason:{kind:'tool-calls'}};
      } else if (!existsSync(checkpoint)) {
        writeFileSync(checkpoint,'ready');
        if (${queueCase}) {
          while (!existsSync(${JSON.stringify(join(root, 'release-transport'))})) await new Promise(resolve=>setTimeout(resolve,20));
          throw new LlmError('fixture connection lost','TRANSPORT');
        }
        await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
      } else {
        if (${queueCase} && !existsSync(${JSON.stringify(join(root, 'native-queue-wake'))})) {
          throw new LlmError('fixture remains unavailable before recovery wake','TRANSPORT');
        }
        const history=JSON.stringify(options.messages);
        if (!history.includes('recorded')) throw new Error('completed tool result missing from recovery history');
        yield {type:'block-start',index:0,blockType:'text'};
        yield {type:'text-delta',index:0,text:'Original task completed after process recovery.'};
        yield {type:'block-end',index:0,block:{type:'text',text:'Original task completed after process recovery.'}};
        yield {type:'finish',reason:{kind:'stop'}};
      }
    }
  }
  ctx.effect(()=>ctx.llm.registerAdapter(['recovery-fixture'],new Adapter()));
  ctx.on('session/event',(session,event)=>{
    if(event.type==='recovery/queued') writeFileSync(${JSON.stringify(join(root, 'native-queue-wake'))},'accepted');
    if(event.type==='turn/end' && event.data.reason.kind==='completed') writeFileSync(completed,JSON.stringify({id:session.id,seq:event.seq}));
  });
}
`)
const patch = join(root, 'fixture.patch.yml')
await writeFile(patch, JSON.stringify([{ id: 'session-title-llm', disabled: true }, { insert: [{ id: 'recovery-acceptance-model', name: pathToFileURL(fixture).href }] }]))
let boundPort = '0'
let child
let childExit
let stdout = ''
let stderr = ''
async function until(test, label) {
  const end = Date.now() + 90000
  while (Date.now() < end) {
    const result = await test()
    if (result) return result
    if (child?.exitCode !== null || child?.signalCode !== null) throw new Error(`${label}: process exited\n${stderr.slice(-10000)}`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`${label}: deadline exceeded\n${stderr.slice(-10000)}`)
}
async function boot() {
  stdout = ''; stderr = ''
  child = spawn(process.execPath, [join(repo, 'apps/cli/lib/bin.js'), 'web', '--patch', patch,
    '--host', '127.0.0.1', '--port', boundPort, '--no-open'], {
    cwd: join(root, 'workspace'), env: { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: join(root, 'agents'),
      DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: '', NODE_OPTIONS: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  childExit = once(child, 'close')
  child.stdout.on('data', data => { stdout += data })
  child.stderr.on('data', data => { stderr += data })
  return await until(() => /dsh web: (http:\/\/[^\s]+)/u.exec(stdout)?.[1], 'web ready')
}
async function stop(signal) {
  if (child && child.exitCode === null && child.signalCode === null) child.kill(signal)
  if (childExit) await childExit
}
const exists = async path => { try { await readFile(path); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error } }
try {
  let url = await boot()
  boundPort = new URL(url).port
  const configPath = join(root, 'recovery.json')
  const driver = join(root, 'driver.py')
  await writeFile(driver, `import sys,json\nsys.path.insert(0,${JSON.stringify(join(repo, 'scripts/session-recovery'))})\nfrom scan import Api,scan\nc=json.load(open(sys.argv[1]));a=Api(c)\nif len(sys.argv)>2:\n print(json.dumps(a.call(sys.argv[2],json.loads(sys.argv[3]))))\nelse:\n print(json.dumps(scan(c,a)))\n`)
  const python = async (method, args) => {
    const proc = spawn('python3', [driver, configPath, ...(method ? [method, JSON.stringify(args)] : [])], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    proc.stdout.on('data', data => { out += data }); proc.stderr.on('data', data => { err += data })
    const [code, signal] = await once(proc, 'close')
    assert.equal(signal, null, err); assert.equal(code, 0, err)
    return JSON.parse(out)
  }
  const configure = async () => {
    const bootstrap = url
    assert.ok(new URL(bootstrap).searchParams.get('token'), 'native authenticated launch URL')
    await writeFile(join(home, 'bootstrap-url.txt'), bootstrap, { mode: 0o600 })
    await writeFile(configPath, JSON.stringify({ origin: new URL(url).origin, tokenFile: join(home, 'bootstrap-url.txt'),
      stateDir: join(root, 'recovery-state'), cooldownSeconds: 1, maxAttempts: 3 }))
    assert.ok(bootstrap)
  }
  await configure()
  const created = await python('session/create', { request: { cwd: join(root, 'workspace') } })
  const sid = created.sessionId
  await python('session/selectModel', { request: { sessionId: sid, provider: 'recovery-fixture', model: 'fixture' } })
  await python('session/prompt', { request: { sessionId: sid, requestId: 'acceptance-original', mode: 'queue', asyncDispatch: true,
    content: [{ type: 'text', text: 'Complete the fixture operation exactly once and report completion.' }] } })
  await until(() => exists(join(root, 'ready-to-kill')), 'completed effect and in-flight model request')
  // Wait for durable settled tool result before abrupt process loss.
  await until(async () => {
    const page = await python('session/events', { request: { address: { kind: 'session', sessionId: sid }, maxEvents: 5000 } })
    return page.records.some(record => record.event.type === 'tool/result' && !record.event.data.isError)
  }, 'durable completed tool')
  if (queueCase) {
    await python('session/prompt', { request: { sessionId: sid, requestId: 'acceptance-existing-queue', mode: 'queue', asyncDispatch: true,
      content: [{ type: 'text', text: 'Preserve this queued instruction and its async dispatch setting.' }] } })
    await writeFile(join(root, 'release-transport'), 'release')
    await until(async () => !(await python('session/state', { request: { sessionId: sid } })).running, 'transport failed with parked queue')
  } else {
    await stop('SIGKILL')
    assert.equal((await readFile(join(root, 'effects.txt'), 'utf8')).trim(), 'effect')
    url = await boot()
    await configure()
  }
  const scans = await until(async () => {
    const rows = await python()
    return rows.some(row => row.reason === 'accepted-awaiting-execution') ? rows : false
  }, 'automatic recovery admitted')
  assert.ok(scans.some(row => row.reason === 'accepted-awaiting-execution'), JSON.stringify(scans))
  await until(() => exists(join(root, 'completed.json')), 'automatic recovered execution completed')
  const observations = await python()
  assert.ok(observations.some(row => row.reason === 'execution-observed' && row.ending === 'completed'), JSON.stringify(observations))
  await python()
  assert.equal((await readFile(join(root, 'effects.txt'), 'utf8')).trim(), 'effect')
  const page = await python('session/events', { request: { address: { kind: 'session', sessionId: sid }, maxEvents: 5000 } })
  const events = page.records.map(row => row.event)
  assert.equal(events.filter(event => event.type === 'tool/call' && event.data.name === 'recovery_effect').length, 1)
  assert.equal(events.filter(event => event.type === 'user/message' && event.data.source.kind === 'retry').length, queueCase ? 0 : 1)
  assert.equal(events.filter(event => event.type === 'recovery/queued').length, queueCase ? 1 : 0)
  assert.equal(events.filter(event => event.type === 'conversation/async-dispatch-admitted' && event.data.enabled === true).length, 1)
  assert.equal(events.filter(event => event.type === 'conversation/async-dispatch-admitted' && event.data.enabled === false).length, 0)
  if (queueCase) {
    const admitted = events.filter(event => event.type === 'user/message' && event.data.source.rpcId === 'acceptance-existing-queue')
    assert.equal(admitted.length, 1)
    assert.equal(admitted[0].data.source.asyncDispatch, true)
  }
  assert.ok(events.some(event => event.type === 'turn/end' && event.data.reason.kind === (queueCase ? 'error' : 'interrupted')))
  await writeFile(join(root, 'evidence.json'), JSON.stringify({ root, sessionId: sid, effects: 1, retries: queueCase ? 0 : 1, queueWakes: queueCase ? 1 : 0,
    reasons: events.filter(event => event.type === 'turn/end').map(event => event.data.reason.kind), scans, observations }, null, 2))
  console.log(JSON.stringify({ result: 'passed', root, sessionId: sid, effects: 1, retries: queueCase ? 0 : 1, queueWakes: queueCase ? 1 : 0 }))
} finally {
  await stop('SIGTERM')
  console.log(`Evidence retained: ${root}`)
}
