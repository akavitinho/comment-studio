const assert=require('node:assert/strict');
const path=require('node:path');
const {app,BrowserWindow}=require('electron');

app.setPath('userData',path.join(__dirname,'..','.smoke','shared-ui-data'));
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:1440,height:920,webPreferences:{preload:path.join(__dirname,'postings-ui-preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});
  try{
    await win.loadFile(path.join(__dirname,'..','src','ui','index.html'));
    const result=await win.webContents.executeJavaScript(`(async()=>{
      document.querySelector('[data-page=postings]').click();
      if(!document.body.dataset.ready)await new Promise(resolve=>setTimeout(resolve,250));
      document.querySelector('[data-posting-tab=shared]').click();
      const visible=selector=>{const node=document.querySelector(selector);return !!node&&!node.closest('[hidden]')&&!node.hidden};
      const initial={controls:visible('#posting-shared-add')&&visible('#posting-shared-start')&&visible('#posting-shared-pause')&&visible('#posting-shared-stop'),picker:document.querySelector('#posting-shared-account-count').textContent,oldDropdown:!!document.querySelector('#posting-shared-controls')};
      const picker=document.querySelector('#posting-shared-picker');picker.open=true;
      const search=document.querySelector('#posting-shared-account-search');search.value='inexistente';search.dispatchEvent(new Event('input',{bubbles:true}));
      const noResults=!document.querySelector('#posting-shared-no-results').hidden;
      search.value='perfil.teste';search.dispatchEvent(new Event('input',{bubbles:true}));
      const found=[...document.querySelectorAll('.posting-shared-choice')].filter(node=>!node.hidden).length;
      document.querySelector('#posting-shared-clear').click();
      const cleared=document.querySelector('#posting-shared-account-count').textContent;
      document.querySelector('#posting-shared-select-all').click();
      const selected=document.querySelector('#posting-shared-account-count').textContent;
      picker.open=false;
      document.querySelector('#posting-shared-caption').value='Legenda padrão';
      document.querySelector('#posting-shared-add').click();
      await new Promise(resolve=>setTimeout(resolve,80));
      const caption=(await window.studio.state()).postings.items.find(item=>item.queue_kind==='shared')?.caption;
      const card=document.querySelector('.posting-shared-account');
      const main=card.querySelector('summary').textContent;
      const compact=!main.includes('Conexão direta')&&!main.includes('Instagram')&&!main.includes('Proxy');
      card.open=true;await new Promise(resolve=>setTimeout(resolve,30));
      const video=card.querySelector('.posting-shared-video')?.textContent||'';
      document.querySelector('#posting-shared-start').click();await new Promise(resolve=>setTimeout(resolve,50));
      const running=(await window.studio.state()).postings.sharedSchedules[0].status;
      document.querySelector('#posting-shared-pause').click();await new Promise(resolve=>setTimeout(resolve,50));
      const paused=(await window.studio.state()).postings.sharedSchedules[0].status;
      document.querySelector('#posting-shared-start').click();await new Promise(resolve=>setTimeout(resolve,50));
      const resumed=(await window.studio.state()).postings.sharedSchedules[0].status;
      document.querySelector('#posting-shared-stop').click();await new Promise(resolve=>setTimeout(resolve,50));
      const stopped=(await window.studio.state()).postings.sharedSchedules[0].status;
      return {initial,noResults,found,cleared,selected,compact,video,caption,running,paused,resumed,stopped};
    })()`);
    assert.deepEqual(result.initial,{controls:true,picker:'1 conta selecionada',oldDropdown:false});
    assert.equal(result.noResults,true);assert.equal(result.found,1);
    assert.equal(result.cleared,'0 contas selecionadas');assert.equal(result.selected,'1 conta selecionada');
    assert.equal(result.compact,true);assert.match(result.video,/mesmo-reel\.mp4/);
    assert.equal(result.caption,'Legenda padrão');
    assert.deepEqual([result.running,result.paused,result.resumed,result.stopped],['running','paused','running','stopped']);
    const responsive=await win.webContents.executeJavaScript(`(async()=>{
      const shell=document.querySelector('.posting-shared-shell'),cards=document.querySelector('.posting-shared-cards');
      const result=[];
      for(const width of [1180,900,650,380]){
        shell.style.width=width+'px';
        await new Promise(resolve=>requestAnimationFrame(resolve));
        result.push(getComputedStyle(cards).gridTemplateColumns.split(' ').length);
      }
      return result;
    })()`);
    assert.deepEqual(responsive,[4,3,2,1]);
    console.log('Fila única UI: controles, seleção, card e execução passaram.');
  }catch(error){console.error('Fila única UI falhou:',error);process.exitCode=1;}
  finally{win.destroy();app.exit(process.exitCode||0);}
}).catch(error=>{console.error(error);app.exit(1);});
