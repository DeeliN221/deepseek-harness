/** Compose only the compact brand CSS into a hash-verified deployed sidebar.
 * Keeps deployment-specific navigation logic byte-for-byte. Usage:
 * node scripts/build-compact-overlay.mjs <baseline.js> <baseline-sha256> <built.js> <output.js>
 */
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const [baselinePath,expectedSha,builtPath,outputPath]=process.argv.slice(2)
assert.ok(baselinePath && expectedSha && builtPath && outputPath)
const baseline=await readFile(baselinePath,'utf8'),built=await readFile(builtPath,'utf8')
assert.equal(createHash('sha256').update(baseline).digest('hex'),expectedSha,'baseline changed')
const cssExpression=/const css = ("[^\n]*");/
const classes=source=>JSON.parse(source.match(/var SidebarRoot_module_css_default = (\{[\s\S]*?\});/)[1])
const oldClasses=classes(baseline),newClasses=classes(built)
assert.deepEqual(Object.keys(newClasses).sort(),Object.keys(oldClasses).sort())
const oldMatch=baseline.match(cssExpression),newMatch=built.match(cssExpression)
const oldCss=JSON.parse(oldMatch[1]);let newCss=JSON.parse(newMatch[1])
for(const key of Object.keys(newClasses).sort((a,b)=>newClasses[b].length-newClasses[a].length))newCss=newCss.split(newClasses[key]).join(oldClasses[key])
const start=newCss.indexOf('.'+oldClasses.brandName+':is(')
const end=newCss.indexOf('.'+oldClasses.fallbackBrandName+'{',start)
assert.ok(start>=0 && end>start,'compact styles missing')
assert.equal(newCss.slice(0,start)+newCss.slice(end),oldCss,'unrelated sidebar styles changed')
const next=baseline.replace(oldMatch[0],()=> 'const css = '+JSON.stringify(newCss)+';')
assert.equal(next.replace(cssExpression,'CSS'),baseline.replace(cssExpression,'CSS'),'non-CSS code changed')
await writeFile(outputPath,next)
console.log(JSON.stringify({baselineSha256:expectedSha,outputSha256:createHash('sha256').update(next).digest('hex'),preservedNonCss:true,addedCssBytes:Buffer.byteLength(newCss)-Buffer.byteLength(oldCss)}))
