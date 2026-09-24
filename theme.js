(()=>{
"use strict";
const STORAGE_KEY="nflTrackerTheme";
const themes=[
  {id:"night",name:"Night Shift",desc:"Deep navy with mint accents",colors:["#11151d","#66d9a8","#6bb7ff"]},
  {id:"buzzer",name:"Buzzer",desc:"Scoreboard black with punchy red",colors:["#050505","#ef3f43","#f4f4f5"]},
  {id:"glacier",name:"Glacier",desc:"Cold navy with electric ice blue",colors:["#08131c","#53d6ff","#8be9fd"]},
  {id:"royal",name:"Royal",desc:"Midnight plum with violet highlights",colors:["#120d1c","#a978ff","#e77dff"]},
  {id:"stadium",name:"Stadium",desc:"Field-dark green with neon lime",colors:["#08130f","#7ee787","#b6f36b"]},
  {id:"gold",name:"Gold Rush",desc:"Blackout panels with warm gold",colors:["#0c0b08","#f4bd50","#ffe19a"]}
];
function savedTheme(){
  try{
    const value=localStorage.getItem(STORAGE_KEY);
    return themes.some(t=>t.id===value)?value:"night";
  }catch(_){return"night"}
}
function applyTheme(id){
  const theme=themes.find(t=>t.id===id)||themes[0];
  document.documentElement.dataset.theme=theme.id;
  document.body&&document.body.setAttribute("data-theme",theme.id);
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.setAttribute("content",theme.colors[0]);
  try{localStorage.setItem(STORAGE_KEY,theme.id)}catch(_){}
  document.querySelectorAll(".theme-choice").forEach(btn=>{
    const active=btn.dataset.themeId===theme.id;
    btn.classList.toggle("active",active);
    btn.setAttribute("aria-checked",active?"true":"false");
  });
  const label=document.getElementById("themeCurrentLabel");
  if(label)label.textContent=theme.name;
}
applyTheme(savedTheme());

function closeMenu(){
  const pop=document.getElementById("themeSettingsPopover"),button=document.getElementById("themeSettingsButton");
  if(pop)pop.hidden=true;
  if(button)button.setAttribute("aria-expanded","false");
}
function build(){
  if(document.getElementById("themeSettings"))return;
  document.body.setAttribute("data-theme",document.documentElement.dataset.theme||savedTheme());
  const wrap=document.createElement("div");
  wrap.id="themeSettings";
  wrap.className="theme-settings";
  wrap.innerHTML=`
    <button id="themeSettingsButton" class="theme-settings-button" type="button" aria-label="Open appearance settings" aria-expanded="false" aria-controls="themeSettingsPopover">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.7a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6Z"/><path d="M19.2 13.4c.05-.46.05-.94 0-1.4l2-1.55-2-3.45-2.48 1a8 8 0 0 0-2.43-1.4L13.9 4h-4l-.4 2.6A8 8 0 0 0 7.08 8L4.6 7l-2 3.45L4.6 12c-.05.46-.05.94 0 1.4l-2 1.55 2 3.45 2.48-1a8 8 0 0 0 2.43 1.4l.39 2.6h4l.4-2.6a8 8 0 0 0 2.42-1.4l2.48 1 2-3.45-2-1.55Z"/></svg>
    </button>
    <div id="themeSettingsPopover" class="theme-settings-popover" hidden>
      <div class="theme-settings-head">
        <div><span>APPEARANCE</span><strong>Theme</strong></div>
        <span id="themeCurrentLabel"></span>
      </div>
      <div class="theme-choice-grid" role="radiogroup" aria-label="Site theme">
        ${themes.map(t=>`
          <button class="theme-choice" type="button" role="radio" aria-checked="false" data-theme-id="${t.id}">
            <span class="theme-preview" aria-hidden="true">
              <i style="--swatch:${t.colors[0]}"></i><i style="--swatch:${t.colors[1]}"></i><i style="--swatch:${t.colors[2]}"></i>
            </span>
            <span class="theme-choice-copy"><strong>${t.name}</strong><small>${t.desc}</small></span>
            <span class="theme-check">✓</span>
          </button>`).join("")}
      </div>
    </div>`;
  const shell=document.querySelector(".shell");
  (shell||document.body).appendChild(wrap);
  const button=document.getElementById("themeSettingsButton"),popover=document.getElementById("themeSettingsPopover");
  button.addEventListener("click",e=>{
    e.stopPropagation();
    const opening=popover.hidden;
    popover.hidden=!opening;
    button.setAttribute("aria-expanded",opening?"true":"false");
  });
  document.querySelectorAll(".theme-choice").forEach(btn=>btn.addEventListener("click",()=>{
    applyTheme(btn.dataset.themeId);
    closeMenu();
  }));
  document.addEventListener("click",e=>{if(!wrap.contains(e.target))closeMenu()});
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeMenu()});
  applyTheme(document.documentElement.dataset.theme||savedTheme());
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",build,{once:true});else build();
})();