import fs from "node:fs/promises";
import { expect } from "@playwright/test";
// Playwright's renderer screenshot omits Electron's separate WebContentsView.
// Include the real native view at its actual bounds, in this isolated test only.
export async function previewWindowImage(app, destination) {
  const expected = await app.page.locator("#previewArea").boundingBox();
  await expect
    .poll(async () =>
      app.mainEvaluate(
        `(()=>{const {BrowserWindow}=process.getBuiltinModule('module').createRequire(process.cwd()+'/v3-test.cjs')('electron');const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/dist/index.html'));return w.contentView.children.find(v=>v.webContents?.getURL().startsWith('aidlc-preview:'))?.getBounds().height;})()`,
      ),
    )
    .toBe(Math.floor(expected.height));
  const base64 = await app.mainEvaluate(`(async()=>{
    const {BrowserWindow,nativeImage}=process.getBuiltinModule('module').createRequire(process.cwd()+'/v3-test.cjs')('electron');
    const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/dist/index.html'));
    const v=w.contentView.children.find(v=>v.webContents?.getURL().startsWith('aidlc-preview:'));
    const parent=await w.webContents.capturePage(),child=await v.webContents.capturePage(),size=parent.getSize(),small=child.getSize(),b=v.getBounds();
    const data=parent.toBitmap({scaleFactor:1}),overlay=child.toBitmap({scaleFactor:1});
    if(data.length!==size.width*size.height*4||overlay.length!==small.width*small.height*4)throw new Error('test screenshot scale mismatch');
    for(let y=0;y<Math.min(b.height,small.height,size.height-b.y);y++)overlay.copy(data,((b.y+y)*size.width+b.x)*4,y*small.width*4,(y*small.width+Math.min(b.width,small.width,size.width-b.x))*4);
    return nativeImage.createFromBitmap(data,{width:size.width,height:size.height,scaleFactor:1}).toPNG().toString('base64');
  })()`);
  await fs.writeFile(destination, Buffer.from(base64, "base64"));
}
