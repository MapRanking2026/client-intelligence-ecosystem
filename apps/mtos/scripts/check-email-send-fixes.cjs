/* eslint-disable @typescript-eslint/no-require-imports -- Isolated service tests with synthetic data. */
require('tsx/cjs');
const assert=require('node:assert/strict');
const Module=require('node:module'), original=Module._load;
let sent=[], client={id:'synthetic-client',name:'Synthetic client',timeZone:'America/Los_Angeles'}, touch={id:'synthetic-touch',clientId:'synthetic-client',scheduledAt:'2026-11-18T01:00:00Z',calendarEventId:'synthetic-event',agendaEmail:{html:'<div>Date</div><div>Wed, November 18</div><div>Time</div><div>8:00 PM EST</div><p>Custom completed work summary stays.</p>',subject:'Agenda 8:00 PM EST',recipient:'client@example.test'}};
const mocks={
 '@/src/lib/server/services/user-service':{getAccountManagerProfile:async()=>({name:'Synthetic AM',timeZone:'America/New_York'}),getAccountManagerPreferences:async()=>({emailSignoff:'Regards, Synthetic AM'})},
 '@/src/lib/server/services/google-meet-service':{readAgendaMeeting:async()=>({scheduledAt:touch.scheduledAt,timeZone:'America/New_York',meetingUrl:'https://meet.google.com/abc-defg-hij',lengthMinutes:60})},
 '@/src/lib/server/services/confirmation-email-service':{resolveRecipient:()=>({recipient:'client@example.test'}),resolveConfirmationContact:()=>''},
 '@/src/lib/server/env':{getServerEnv:()=>({appUrl:'https://example.test'})},
 '@/src/lib/server/services/mtos-ai':{getNowIso:()=>new Date().toISOString()},
 '@/src/lib/server/gmail':{sendGmailMessage:async(_,message)=>{sent.push(message);return {sent:true,messageId:'synthetic-message'};},verifyGmailMessageAccepted:async()=>({sent:true})},
 '@/src/lib/server/data/seed-mtos-data-source':{getMtosDataSource:()=>({getMonthlyTouchById:async()=>touch,getClientById:async()=>client})},
 '@/src/lib/server/firebase/admin':{getFirebaseAdminDb:()=>({doc:()=>({update:async patch=>Object.assign(client,patch)})})},
 '@/src/lib/server/firebase/collections':{clientPath:()=> 'synthetic-client'}
};
Module._load=function(request,parent,...rest){if(/(?:agenda-email-service|client-email-service|client-time-zone-service)\.ts$/.test(parent?.filename||'')&&mocks[request])return mocks[request];return original.call(this,request,parent,...rest);};
async function main(){try{
 const {readAgendaEmail}=require('../src/lib/server/services/agenda-email-service.ts');
 const {sendClientEmail}=require('../src/lib/server/services/client-email-service.ts');
 const {saveClientTimeZone}=require('../src/lib/server/services/client-time-zone-service.ts');
 const ctx={tenantId:'synthetic-tenant',userId:'synthetic-am'};
 let view=await readAgendaEmail(ctx,touch,client);
 assert.match(view.state.html,/5:00 PM PST/);assert.doesNotMatch(view.state.html,/EST|November 18/);assert.match(view.state.html,/Custom completed/);
 assert.match(view.state.subject,/5:00 PM PST/);
 let result=await sendClientEmail(ctx,{recipient:'client@example.test',subject:'Agenda',html:'<div>Your check-in agenda, Sparkle Plumbing</div><p>Here is what we will cover: Google Ads performance.</p><!-- pending task -->',clientName:'Sparkle Plumbing',blockedTaskTitles:['Sparkle Plumbing','check-in agenda','Google Ads'],idempotencyKey:'synthetic'});
 assert.equal(result.sent,true); assert.equal(sent.length,1);
 result=await sendClientEmail(ctx,{recipient:'client@example.test',subject:'Agenda',html:'<p>Pending task: fix schema.</p>',idempotencyKey:'synthetic-2'});
 assert.equal(result.sent,false);assert.match(result.detail,/Pending task: fix schema/);assert.equal(sent.length,1);
 client={...client,timeZone:undefined};view=await readAgendaEmail(ctx,touch,client);
 assert.ok(view.state.blockingGaps.some(gap=>/time zone/i.test(gap)));assert.doesNotMatch(view.state.html,/EST|PST/);
 await assert.rejects(saveClientTimeZone(ctx,touch.id,'EST'),/IANA/);
 await saveClientTimeZone(ctx,touch.id,'America/Chicago');assert.equal(client.timeZone,'America/Chicago');assert.equal(touch.scheduledAt,'2026-11-18T01:00:00Z');
 view=await readAgendaEmail(ctx,touch,client);assert.match(view.state.html,/7:00 PM CST/);
 touch.agendaEmail.sentAt='2026-11-17T00:00:00Z';view=await readAgendaEmail(ctx,touch,client);assert.equal(view.state.html,touch.agendaEmail.html);
 console.log('PASS mocked Gmail approval routing, actionable privacy error, saved legacy draft correction, client-zone persistence and immutable sent email');
}finally{Module._load=original;}}
main().catch(error=>{console.error(error);process.exitCode=1;});
