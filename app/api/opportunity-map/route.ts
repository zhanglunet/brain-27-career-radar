type OpportunityRow={id:string;name:string;org:string;kind:string;status:string;location:string;deadline:string;deadline_at:string|null;deadline_status:string;url:string;action:string};
const places=[
{id:"london",label:"伦敦",labelEn:"London",region:"英国",lat:51.5074,lon:-0.1278,matches:["London"]},
{id:"oxford",label:"牛津",labelEn:"Oxford",region:"英国",lat:51.752,lon:-1.2577,matches:["Oxford"]},
{id:"cambridge",label:"剑桥",labelEn:"Cambridge",region:"英国",lat:52.2053,lon:0.1218,matches:["Cambridge"]},
{id:"hong-kong",label:"香港",labelEn:"Hong Kong",region:"中国香港",lat:22.3193,lon:114.1694,matches:["香港","Hong Kong"]},
{id:"beijing",label:"北京",labelEn:"Beijing",region:"中国内地",lat:39.9042,lon:116.4074,matches:["北京"]},
{id:"shanghai",label:"上海",labelEn:"Shanghai",region:"中国内地",lat:31.2304,lon:121.4737,matches:["上海"]},
{id:"shenzhen",label:"深圳",labelEn:"Shenzhen",region:"中国内地",lat:22.5431,lon:114.0579,matches:["深圳"]},
{id:"harbin",label:"哈尔滨",labelEn:"Harbin",region:"中国内地",lat:45.8038,lon:126.535,matches:["哈尔滨"]},
{id:"chengdu",label:"成都",labelEn:"Chengdu",region:"中国内地",lat:30.5728,lon:104.0668,matches:["成都"]},
{id:"hangzhou",label:"杭州",labelEn:"Hangzhou",region:"中国内地",lat:30.2741,lon:120.1551,matches:["杭州"]},
]as const;
export async function GET(){try{const{env}=await import("cloudflare:workers");if(!env.DB)throw new Error("D1 binding DB is unavailable");const result=await env.DB.prepare(`SELECT id,name,org,kind,status,location,deadline,deadline_at,deadline_status,url,action FROM opportunities WHERE published=1 ORDER BY COALESCE(deadline_at,'9999-12-31'),created_at DESC`).all<OpportunityRow>();const mapped=places.map((place)=>{const opportunities=result.results.filter((row)=>place.matches.some((term)=>row.location.includes(term)));return{...place,x:((place.lon+180)/360)*1000,y:((90-place.lat)/180)*500,opportunities:opportunities.map(format),count:opportunities.length}}).filter((place)=>place.count>0);const regions=["英国","中国内地","中国香港"].map((region)=>{const ids=new Set(mapped.filter((place)=>place.region===region).flatMap((place)=>place.opportunities.map((item)=>item.id)));return{region,count:ids.size,points:mapped.filter((place)=>place.region===region).length}});return Response.json({generatedAt:new Date().toISOString(),totalUnique:result.results.length,regions,points:mapped},{headers:{"Cache-Control":"no-store"}})}catch(error){console.error(JSON.stringify({event:"radar.opportunity_map.failed",error:message(error)}));return Response.json({error:"opportunity map is temporarily unavailable"},{status:503})}}
function format(row:OpportunityRow){return{id:row.id,name:row.name,org:row.org,kind:row.kind,status:row.status,location:row.location,deadline:row.deadline,deadlineAt:row.deadline_at,deadlineStatus:row.deadline_status,url:row.url,action:row.action}}
function message(error:unknown){return error instanceof Error?error.message.slice(0,500):String(error).slice(0,500)}
