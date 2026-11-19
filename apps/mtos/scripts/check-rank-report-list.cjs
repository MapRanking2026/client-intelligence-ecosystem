/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic service isolation; no live requests. */
require('tsx/cjs');
const assert=require('node:assert/strict'), Module=require('node:module'), original=Module._load, originalFetch=global.fetch;
const businesses=Array.from({length:6},(_,index)=>({businessId:'location-'+index,businessName:'Synthetic Plumbing',address:(100+index)+' Test Street'}));
let requests=[], mode='ok';
const touch={id:'synthetic-touch',clientId:'synthetic-client',prepPack:{seoPerformance:{matchedBusinesses:businesses.slice(0,5),profiles:[{business:businesses[5]}]}}};
const mocks={
 '@/src/lib/server/data/seed-mtos-data-source':{getMtosDataSource:()=>({getMonthlyTouchById:async()=>touch,getClientById:async()=>({id:'synthetic-client',name:'Synthetic Plumbing'})})},
 './mapranking-dashboard':{openDashboardSession:async()=>({baseUrl:'https://rank.example.test',token:'synthetic-token'})},
 './rank-comparison-capture':{captureOriginalRankComparison:()=>{throw Error('Must not capture maps while loading locations');}}
};
Module._load=function(request,parent,...rest){if(parent?.filename.endsWith('original-rank-report-service.ts')&&mocks[request])return mocks[request];return original.call(this,request,parent,...rest);};
global.fetch=async(url,options)=>{
 const parsed=new URL(url);requests.push(parsed);assert.equal(parsed.origin,'https://rank.example.test');assert.equal(options.headers.authorization,'Bearer synthetic-token');
 if(mode==='400')return Response.json({message:'Synthetic provider validation error'}, {status:400});
 if(mode==='401')return Response.json({message:'Synthetic expired token'}, {status:401});
 assert.equal(parsed.searchParams.get('limit'),'10','report list uses the same supported page size as the native UI');
 const page=Number(parsed.searchParams.get('page'));
 const rows=page===1?[...businesses.slice(0,4).map((business,index)=>({id:'report-'+index,name:business.businessName,address:business.address})),...Array.from({length:6},(_,index)=>({id:'other-'+index,name:'Other Account',address:'Other Street'}))]:[{id:'report-3',name:businesses[3].businessName,address:businesses[3].address},...businesses.slice(4).map((business,index)=>({id:'report-'+(index+4),name:business.businessName,address:business.address}))];
 return Response.json({data:{items:rows,total:13}});
};
(async()=>{try{
 const {listOriginalReports}=require('../src/lib/server/services/original-rank-report-service.ts');const ctx={tenantId:'synthetic',userId:'synthetic-am',role:'account_manager'};
 const reports=await listOriginalReports(ctx,'synthetic-touch');assert.equal(reports.length,6);assert.equal(new Set(reports.map(item=>item.id)).size,6);assert.deepEqual(requests.map(url=>url.searchParams.get('page')),['1','2']);assert.ok(requests.every(url=>url.searchParams.get('search')==='Synthetic Plumbing'));
 mode='400';await assert.rejects(listOriginalReports(ctx,'synthetic-touch'),error=>error.message.includes('Synthetic provider validation error')&&!error.message.includes('Reconnect'));
 mode='401';await assert.rejects(listOriginalReports(ctx,'synthetic-touch'),/Reconnect Rank Tracker/);
 console.log('PASS native report-list page size, pagination, six matched locations, duplicate/other-account filtering and accurate provider-error recovery');
}finally{Module._load=original;global.fetch=originalFetch;}})().catch(error=>{console.error(error);process.exitCode=1;});
