import { createClient } from "npm:@supabase/supabase-js@2.112.4";
const expectedHash = "8c9245f9a07466032b680626e7c06d9497c151b634ea9d5853882c567f2c310b";
const owner = "4de003e1-6f38-49a3-9a4e-9f0e68efcd70";
const permitted = ["80e7f4cb-6b20-433b-a8b4-acfc7d26da79","f553a7ce-6e0a-41e9-9841-f971f8b6daa8","3c285dbd-f788-4100-afcb-2e00598064a0","ab3fcc42-4b4f-4571-8772-f5ffd25843be","214e4827-d6e1-479b-a224-25ec76565add","d31af32b-e8b5-411a-acac-c28371f74868","beef397f-c437-4069-88f6-76868645fb14"];
const ttl = 900;
const headers = {"Content-Type":"application/json", "Cache-Control":"no-store", "Access-Control-Allow-Origin":"https://gido70.github.io", "Access-Control-Allow-Headers":"content-type", "Access-Control-Allow-Methods":"POST, OPTIONS", "Referrer-Policy":"no-referrer"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return reply({error:"METHOD_NOT_ALLOWED"},405);
 if(Number(req.headers.get("content-length")||0)>1024)return reply({error:"INVALID_REQUEST"},400);
 try {
  const raw=await req.text(); if(raw.length>1024)return reply({error:"INVALID_REQUEST"},400);
  const input=JSON.parse(raw);
  if(typeof input.token!=="string" || !/^[a-f0-9]{64}$/.test(input.token))return reply({error:"ACCESS_DENIED"},403);
  const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(input.token)));
  const actual=Array.from(digest,x=>x.toString(16).padStart(2,"0")).join("");
  let diff=0;for(let i=0;i<expectedHash.length;i++)diff|=actual.charCodeAt(i)^expectedHash.charCodeAt(i);
  if(diff!==0)return reply({error:"ACCESS_DENIED"},403);
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
  if(input.action==="list"){
   const {data,error}=await db.from("spl_books").select("id,title,source_language,output_language,metadata").eq("user_id",owner).in("id",permitted);
   if(error)throw error;
   const books=(data||[]).map(b=>({id:b.id,title:b.title,source_language:b.source_language,output_language:b.output_language,archived:Boolean(b.metadata?.archived_at),author:String(b.metadata?.author||""),subject:String(b.metadata?.subject||""),classification:String(b.metadata?.dewey_branch||b.metadata?.dewey_main||"")}));
   return reply({books});
  }
  if(input.action!=="book"|| !permitted.includes(input.bookId))return reply({error:"ACCESS_DENIED"},403);
  const {data:b,error:be}=await db.from("spl_books").select("id,title,storage_path,metadata").eq("user_id",owner).eq("id",input.bookId).single();if(be||!b)return reply({error:"ACCESS_DENIED"},403);
  const prefix=owner+"/"+b.id+"/";
  const sign=async(bucket:string,path:unknown)=>{if(typeof path!=="string"||!path.startsWith(prefix)||path.includes(".."))return null;const {data,error}=await db.storage.from(bucket).createSignedUrl(path,ttl);return error?null:data.signedUrl;};
  const [{data:analyses,error:ae},{data:audio,error:se}]=await Promise.all([
   db.from("spl_analyses").select("kind,language,content").eq("user_id",owner).eq("book_id",b.id).order("created_at",{ascending:false}),
   db.from("spl_audio_outputs").select("storage_path,part_no,voice,language").eq("user_id",owner).eq("book_id",b.id).order("part_no")
  ]);if(ae||se)throw ae||se;
  const pdfUrl=b.metadata?.original_removed?null:await sign("spl-books",b.storage_path);
  const coverUrl=await sign("spl-books",b.metadata?.archive_cover_path);
  const tracks=await Promise.all((audio||[]).map(async a=>({url:await sign("spl-audio",a.storage_path),part:a.part_no,voice:a.voice,language:a.language})));
  return reply({analyses:analyses||[],audio:tracks.filter(a=>a.url),pdfUrl,coverUrl,expiresAt:Date.now()+ttl*1000});
 }catch{return reply({error:"UNAVAILABLE"},503);}
});
