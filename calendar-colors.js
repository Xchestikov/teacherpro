/* TeacherPro calendar: warm stable student colors and visible status markers.
   Only presentation: all status/accounting comes from existing lesson records. */
(function(){
'use strict';
const palette=[
 ['#e9edf8','#7b92c3','#42577e'], // powder blue
 ['#f7e8e0','#ca8d76','#8a5546'], // terracotta
 ['#e8f1e7','#8bae93','#466f50'], // sage
 ['#f7edf4','#c49cb9','#7c5874'], // rose
 ['#f1e9fa','#a895cb','#66538f'], // lavender
 ['#f9efdf','#d1aa75','#85623e'], // ochre
 ['#e4f1f0','#7faeac','#426e71'], // sea glass
 ['#f7e6e9','#cd93a1','#914e60'], // dusty rose
 ['#eceee3','#a5ae83','#687448'], // olive
 ['#f9ece8','#d7a098','#925750'], // coral
 ['#e8ebf6','#96a6cf','#53628b'], // blue iris
 ['#edeaf3','#aa9cb9','#706283']  // mauve
];
window.tpStudentCalendarPalette=palette;
const hashId=key=>Array.from(key).reduce((acc,char)=>(acc*31+char.charCodeAt(0))>>>0,0);
const assigned=id=>{
 const key=String(id??'');
 const students=(db.clients||[]).map(c=>String(c.id)).sort((a,b)=>a.localeCompare(b,'ru',{numeric:true}));
 // Keep colors distinct for up to 12 students while preferring a
 // deterministic hash. Newer student IDs do not recolor older students.
 const assignedColors=new Map(),occupied=new Set();
 for(const studentId of students){
   let index=hashId(studentId)%palette.length;
   if(occupied.size<palette.length){
     while(occupied.has(index))index=(index+1)%palette.length;
   }
   occupied.add(index);assignedColors.set(studentId,index);
 }
 return palette[assignedColors.get(key)??(hashId(key)%palette.length)];
};
function decorate(){
 const all=document.querySelectorAll('.calendar-grid .calendar-event');
 for(const event of all){
  const l=db.lessons.find(row=>String(row.id)===String(event.dataset.lessonId));
  if(!l)continue;
  const [fill,edge,ink]=assigned(l.clientId);
  event.style.setProperty('--tp-student-fill',fill);
  event.style.setProperty('--tp-student-edge',edge);
  event.style.setProperty('--tp-student-ink',ink);
  event.classList.add('tp-colored-event');
  event.querySelector('.tp-lesson-mark')?.remove();
  const mark=l.status==='done'?'✓':lessonIsCancelled(l.status)?'×':null;
  if(mark){
    const symbol=document.createElement('span');
    symbol.className='tp-lesson-mark '+(l.status==='done'?'tp-lesson-done':'tp-lesson-cancelled');
    symbol.setAttribute('aria-label',l.status==='done'?'Занятие проведено':lessonStatusText(l.status));
    symbol.title=lessonStatusText(l.status);
    symbol.textContent=mark;
    event.append(symbol);
  }
 }
}
const nativeSchedule=schedule;
schedule=function(){nativeSchedule();if(page==='schedule')decorate();};
})();
