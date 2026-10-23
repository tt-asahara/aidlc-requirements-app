export async function installTestBrowser(app, issuer, forward = true) {
  // Only the OS browser launcher is replaced through this isolated process's
  // explicitly enabled Node inspector. Production entry/IPC/auth code is unchanged.
  await app.mainEvaluate(`(async()=>{
    const {shell}=process.getBuiltinModule('module').createRequire(process.cwd()+'/v3-test.cjs')('electron');
    shell.openExternal=async url=>{
      if(new URL(url).origin!==${JSON.stringify(issuer)})throw new Error('unexpected test issuer');
      ${
        forward
          ? `const https=process.getBuiltinModule('https'),http=process.getBuiltinModule('http');
      const location=await new Promise((resolve,reject)=>https.get(url,res=>{res.resume();resolve(res.headers.location);}).on('error',reject));
      const target=new URL(location);
      if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||target.pathname!=='/oidc-callback')throw new Error('unexpected callback');
      await new Promise((resolve,reject)=>http.get(target,res=>{res.resume();res.on('end',resolve);}).on('error',reject));`
          : ""
      }
    };return true;
  })()`);
}
