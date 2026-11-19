import {describe,it,expect} from 'vitest'
import type {SessionListState, SessionSummary} from '@deepseek-ai/dsh-api-session-controller/client'
import type {SessionId} from '@deepseek-ai/dsh-session/types'
import {sidebarList,sidebarSearch} from '../src/client/sidebar-visibility.ts'
import {deriveFlat} from '../src/client/tree.ts'
const id=(s:string)=>s as SessionId
const rows=['user','fork','internal','archived-user','archived-internal'].map(s=>({id:id(s),title:s,displayTitle:s,running:false,blank:false,updatedAt:1,retainedBy:{}} satisfies SessionSummary))
const list:SessionListState={ids:rows.map(r=>r.id),byId:Object.fromEntries(rows.map(r=>[r.id,r])),phase:'ready',projectionsBySession:{}}
describe('sidebar provenance boundary',()=>{
  it('hides only exact mapped ids without mutating openable sessions or projections',()=>{
    const filtered=sidebarList(list,[id('internal'),id('archived-internal')])
    expect(filtered.ids).toEqual(['user','fork','archived-user'])
    expect(list.byId[id('internal')]).toBeDefined()
    expect(filtered.projectionsBySession).toBe(list.projectionsBySession)
    expect(sidebarList(list,[])).toBe(list)
  })
  it('keeps archive filters and ordinary fork unchanged across refresh',()=>{
    const filtered=sidebarList(JSON.parse(JSON.stringify(list)),[id('internal'),id('archived-internal')])
    const state={pinnedSessionIds:[],archivedSessionIds:[id('archived-user'),id('archived-internal')],archivedFilter:'only' as const}
    expect(deriveFlat(filtered,list.ids,state,new Map()).map(r=>r.id)).toEqual(['archived-user'])
    expect(deriveFlat(filtered,list.ids,{...state,archivedFilter:'default'},new Map()).map(r=>r.id)).toEqual(['user','fork'])
  })
  it('filters cold search results with the same exact policy',()=>{
    expect(sidebarSearch([{sessionId:id('internal'),snippet:'hit'},{sessionId:id('fork'),snippet:'hit'}],[id('internal')])).toEqual([{sessionId:'fork',snippet:'hit'}])
  })
})
