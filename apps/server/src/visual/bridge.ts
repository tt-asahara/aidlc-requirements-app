/** Read-only instrumentation inside the opaque preview. Replies remain untrusted input. */
export function captureBridge(channel: string, sourceSha256: string) {
  const script = `(() => {
const channel=${JSON.stringify(channel)}, sourceSha256=${JSON.stringify(sourceSha256)};
addEventListener('message', event => {
 if(event.source!==parent || event.data?.type!=='aidlc:capture' || event.data.channel!==channel || typeof event.data.requestId!=='string') return;
 const requestId=event.data.requestId;
 try {
  const nodes=[document.documentElement,...document.documentElement.querySelectorAll('*')];
  if(nodes.length>5000) throw Error('DOMが5000要素を超えています。');
  if(nodes.some(n=>n.shadowRoot) || document.querySelector('canvas,video,audio,iframe,object,embed,input[type=password],input[type=file]')) throw Error('canvas・動画・入れ子フレーム・Shadow DOM・秘密入力は撮影対象外です。');
  const clone=document.documentElement.cloneNode(true), copies=[clone,...clone.querySelectorAll('*')];
  nodes.forEach((node,i)=>{
   const copy=copies[i];
   if(node instanceof HTMLInputElement){copy.setAttribute('value',node.value);copy.toggleAttribute('checked',node.checked);}
   if(node instanceof HTMLTextAreaElement) copy.textContent=node.value;
   if(node instanceof HTMLOptionElement) copy.toggleAttribute('selected',node.selected);
   if(node.scrollTop || node.scrollLeft){copy.setAttribute('data-aidlc-scroll',JSON.stringify([node.scrollLeft,node.scrollTop]));}
   if(node instanceof HTMLStyleElement && node.sheet) {try {copy.textContent=Array.from(node.sheet.cssRules,r=>r.cssText).join('\\n');} catch {}}
   for(const attr of Array.from(copy.attributes)) {
    if(/^on/i.test(attr.name)) copy.removeAttribute(attr.name);
    if(['src','href','poster'].includes(attr.name)) {
     const u=new URL(attr.value,location.href), prefix=location.pathname.split('/').slice(0,3).join('/')+'/';
     if(u.origin===location.origin && u.pathname.startsWith(prefix)) copy.setAttribute(attr.name,'/'+u.pathname.slice(prefix.length));
    }
   }
  });
  clone.querySelectorAll('script,base,meta[http-equiv],input[type=hidden]').forEach(n=>n.remove());
  const html='<!doctype html>'+clone.outerHTML;
  if(new TextEncoder().encode(html).length>80000) throw Error('操作後HTMLが80KBを超えています。');
  parent.postMessage({type:'aidlc:scene',channel,requestId,scene:{html,sourceSha256,scrollX,scrollY},viewport:{width:innerWidth,height:innerHeight}},'*');
 } catch(error) { parent.postMessage({type:'aidlc:scene',channel,requestId,error:String(error.message||error)},'*'); }
});
})();`;
  return `<script>${script.replaceAll("</script", "<\\/script")}</script>`;
}
