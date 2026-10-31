(function () {
  'use strict';
  var C = window.CatchIt = window.CatchIt || {};
  var DAY = 86400;
  function parse(s) { var p = s.split(':'); return (+p[0] * 60 + +p[1]) * 60; }
  function time(s) { if (!Number.isFinite(s)) return '—'; s = ((s % DAY) + DAY) % DAY; return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor(s % 3600 / 60)).padStart(2, '0'); }
  function dur(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ' мин' + (s % 60 ? ' ' + s % 60 + ' с' : ''); }
  function copies(list, start, end) { var result = []; for (var day = Math.floor(start / DAY) - 1; day <= Math.floor(end / DAY) + 1; day++) list.forEach(function (t) { var dep = day * DAY + parse(t.depTime); if (dep >= start && dep <= end) result.push(Object.assign({}, t, { dep: dep, arr: t.arrTime === '—' ? null : dep + ((parse(t.arrTime) - parse(t.depTime) + DAY) % DAY) })); }); return result.sort(function (a,b) { return a.dep - b.dep; }); }
  function node(code, seg, title, start, end, mode, slack, hint, delta) { return { nodeCode: code, segmentCode: seg, title: title, time: time(start) + ' → ' + time(end), durationSec: Math.max(0,end-start), modeUsed: mode || null, slackSec: slack == null ? null : slack, hint: hint || null, canCalibrate: seg === 'S3' || seg === 'S6', currentDeltaSec: delta || 0 }; }
  function hintFor(sec, hints) { var h = hints.find(function (x) { return sec >= x.minSec; }); return { icon: h.icon, text: 'Запас ' + (sec < 0 ? '−' : '') + dur(Math.abs(sec)) + '. ' + h.text, severity: h.severity }; }
  function mckNext(t, p, snapshot) { var h = p.mckHeadwaySec; return snapshot.flags.mckHeadwayFallback ? t + h / 2 : Math.ceil((t - (snapshot.schedules.mck.offsetSec || 0)) / h) * h + (snapshot.schedules.mck.offsetSec || 0); }
  function mckPrevious(t, p, snapshot) { var h = p.mckHeadwaySec; return snapshot.flags.mckHeadwayFallback ? t - h / 2 : Math.floor((t - (snapshot.schedules.mck.offsetSec || 0)) / h) * h + (snapshot.schedules.mck.offsetSec || 0); }
  function calculateRoutePlan(input, world) {
    var p = world.profile, hints = world.hints.hints, flags = world.flags, schedules = world.schedules;
    var start = input.baseTime + input.startOffset * 60, combos = ['CC','CF','FC','FF'];
    var all = copies(schedules.okruzhnaya_to_katuar, start - 3600, start + DAY * 2);
    var reverse = copies(schedules.katuar_to_okruzhnaya, input.arriveBy - DAY * 2, input.arriveBy + 3600);
    var cancelledUid = null;
    function durations(code) { return { s3: Math.max(30, p.s3[code[0] === 'C' ? 'calm':'fast'] + input.deltaS3), s6: Math.max(30, p.s6[code[1] === 'C' ? 'calm':'fast'] + input.deltaS6) }; }
    function prefix(code) {
      var d = durations(code), t = start, ns = [], a = t;
      var walk = input.busMode === 'aboard' ? 0 : p.walkToBusSec; t += walk; ns.push(node('N1','S0','До остановки автобуса 789',a,t,'calm'));
      a=t; t += input.busMode === 'aboard' ? 0 : input.busMode === 'auto' ? p.busHeadwaySec / 2 : input.busWait * 60; ns.push(node('N2','S1','Ожидание автобуса 789',a,t));
      a=t;t+=p.busRideSec;ns.push(node('N3','S2','Автобус до Ботанического сада',a,t));
      a=t;t+=d.s3;ns.push(node('N4','S3','Переход на платформу МЦК',a,t,code[0]==='C'?'calm':'fast',null,null,input.deltaS3));
      a=t;t=mckNext(t,p,world);ns.push(node('N5','S4','Ожидание МЦК',a,t)); var mckDep=t;
      a=t;t+=p.mckRideSec;ns.push(node('N6','S5','МЦК до Окружной',a,t));
      a=t;t+=d.s6;ns.push(node('N7','S6','Переход на ж/д Окружная',a,t,code[1]==='C'?'calm':'fast',null,null,input.deltaS6));
      return {atPlatform:t,nodes:ns,mckDep:mckDep};
    }
    var pre = {}; combos.forEach(function(c){pre[c]=prefix(c);});
    if (flags.targetTrainCancelled) {
      if (input.direction === 'to_home') { var candidate = all.find(function(t){return t.servesKatuar && t.dep >= pre.FF.atPlatform - 30;}); if(candidate) cancelledUid=candidate.uid; }
      else { var deadline = input.arriveBy - p.walkToBusSec - p.busRideSec - p.busHeadwaySec/2 - durations('FF').s3 - p.mckRideSec - p.mckHeadwaySec/2 - durations('FF').s6; var revCandidate = reverse.filter(function(t){return t.arr <= deadline;}).pop(); if(revCandidate) cancelledUid=revCandidate.uid; }
    }
    function valid(t) {return t.servesKatuar && t.uid !== cancelledUid;}
    var plans = {};
    function forward(code, forcedTrain) {
      var x=pre[code], buffer=p.boardingBuffer[code[1]==='C'?'calm':'fast'];
      var train=forcedTrain || all.find(function(t){return valid(t) && t.dep-x.atPlatform>=buffer;});
      if (!train) return null;
      var slack=train.dep-x.atPlatform, ns=x.nodes.map(function(n){return Object.assign({},n);});
      ns[6].slackSec=slack; ns[6].hint=hintFor(slack,hints);
      ns.push(node('N8','S7','Посадка в электричку',x.atPlatform,Math.max(x.atPlatform,train.dep),null,slack,hintFor(slack,hints)));
      ns.push(node('N9','S8','Электричка до Катуара',train.dep,train.arr));
      ns.push(node('N10','S9','Пешком до дома',train.arr,train.arr+p.walkHomeSec,'calm'));
      return {code:code, train:train, slack:slack, arrival:train.arr+p.walkHomeSec, departure:start,nodes:ns,mckDep:x.mckDep};
    }
    function backward(code) {
      var d=durations(code), end=input.arriveBy, latestBus=end-p.walkToBusSec-p.busRideSec-p.busHeadwaySec/2, latestMckArrival=latestBus-d.s3;
      var mckDep=mckPrevious(latestMckArrival-p.mckRideSec,p,world), trainDeadline=mckDep-d.s6;
      var tr=reverse.filter(function(t){return valid(t) && t.arr<=trainDeadline;}).pop(); if(!tr) return null;
      var dep=tr.dep-p.walkHomeSec-p.boardingBuffer[code[1]==='C'?'calm':'fast'], slack=trainDeadline-tr.arr;
      var ns=[node('N1','S9','До станции Катуар',dep,dep+p.walkHomeSec,'calm'),node('N2','S7','Посадка в электричку',dep+p.walkHomeSec,tr.dep,null,tr.dep-(dep+p.walkHomeSec)),node('N3','S8','Электричка до Окружной',tr.dep,tr.arr),node('N4','S6','Переход ж/д → МЦК',tr.arr,tr.arr+d.s6,code[1]==='C'?'calm':'fast',slack,hintFor(slack,hints),input.deltaS6),node('N5','S4','Ожидание МЦК',tr.arr+d.s6,mckDep),node('N6','S5','МЦК до Ботанического сада',mckDep,mckDep+p.mckRideSec),node('N7','S3','Переход к автобусу 789',mckDep+p.mckRideSec,mckDep+p.mckRideSec+d.s3,code[0]==='C'?'calm':'fast',null,null,input.deltaS3),node('N8','S1','Ожидание автобуса 789',mckDep+p.mckRideSec+d.s3,latestBus+p.busHeadwaySec/2),node('N9','S2','Автобус до Вешних Вод',latestBus+p.busHeadwaySec/2,end-p.walkToBusSec),node('N10','S0','От остановки до Вешних Вод',end-p.walkToBusSec,end,'calm')];
      return {code:code,train:tr,slack:slack,arrival:end,departure:dep,nodes:ns,mckDep:mckDep};
    }
    combos.forEach(function(c){plans[c]=input.direction==='to_home'?forward(c):backward(c);});
    var calm=plans.CC, best, recommended, early=null, gain=0, code='CALM', probability=null;
    if (!calm) throw new Error('В расписании нет подходящего рейса');
    if (input.direction==='to_home') {
      early=all.find(function(t){return valid(t) && t.dep >= pre.FF.atPlatform-30;});
      gain=early ? Math.round((calm.arrival-(early.arr+p.walkHomeSec))/60) : 0;
      if (gain>=5) {
        var possible=combos.map(function(c){return forward(c,early);}).filter(function(x){return x.slack>=-30;});
        possible.sort(function(a,b){var ea=(a.code[0]==='F')+(a.code[1]==='F'), eb=(b.code[0]==='F')+(b.code[1]==='F'); return ea-eb || b.slack-a.slack;});
        best=possible[0]; code=best.slack>90?'HURRY':'FREE_OPTION';
        probability=code==='HURRY'?Math.min(98,Math.round(85+(best.slack-90)/30)):Math.round(15+(best.slack+30)/120*70);
      } else {gain=0;best=calm;code=calm.slack<90?'CALM_TIGHT':'CALM';}
    } else {
      var eligible=combos.map(function(c){return plans[c];}).filter(Boolean).sort(function(a,b){return b.departure-a.departure || ((a.code[0]==='F')+(a.code[1]==='F'))-((b.code[0]==='F')+(b.code[1]==='F'));});
      best=eligible[0] || calm; gain=Math.max(0,Math.round((best.departure-calm.departure)/60)); if(gain<5){best=calm;gain=0;} code=gain?'HURRY':calm.slack<90?'CALM_TIGHT':'CALM';
    }
    recommended=input.forceCalmToday?calm:best;
    if(input.forceCalmToday){code=calm.slack<90?'CALM_TIGHT':'CALM';probability=null;}
    var advice={CC:'На обеих пересадках можно идти спокойно.',CF:'Ускорься только на Окружной. На Ботаническом саду можно идти спокойно.',FC:'Ускорься только на Ботаническом саду. На Окружной можно идти спокойно.',FF:'Ускорься на обеих пересадках.'};
    var labels={CC:'Спокойно на обеих пересадках',CF:'Бот. сад спокойно · Окружная быстро',FC:'Бот. сад быстро · Окружная спокойно',FF:'Быстро на обеих пересадках'};
    var warnings=[]; if(flags.apiTimeout)warnings.push('API недоступен: используем локальное расписание из кэша.'); if(flags.schemaErrorRecovered)warnings.push('Повреждённая схема ответа: данные проверены и восстановлены из кэша; неизвестные поля удалены.'); if(flags.staleCache)warnings.push('Расписание устарело более чем на 36 часов. Проверь рейс перед поездкой.'); if(flags.mckHeadwayFallback)warnings.push('Расписание МЦК недоступно: ожидание рассчитано по половине интервала.'); if(flags.targetTrainCancelled)warnings.push('Целевая электричка отменена. Маршрут перестроен на следующий доступный рейс.');
    var planDto=function(x){return {comboCode:x.code,label:labels[x.code],departureTime:time(x.departure),arrivalHomeTime:time(x.arrival),targetTrain:{uid:x.train.uid,depTime:time(x.train.dep),arrTime:time(x.train.arr),destination:x.train.destination,trainType:x.train.trainType,slackSec:x.slack},deadlines: input.direction==='to_home'?[{nodeCode:'N5',label:'Сесть в МЦК не позже',time:time(x.mckDep),isCritical:true},{nodeCode:'N7',label:'Быть на платформе до',time:time(x.train.dep-p.boardingBuffer[x.code[1]==='C'?'calm':'fast']),isCritical:true}]:[{nodeCode:'N0',label:'Выйти из дома до',time:time(x.departure),isCritical:true},{nodeCode:'N5',label:'Сесть в МЦК',time:time(x.mckDep),isCritical:true}],nodes:x.nodes};};
    var title=code==='HURRY'?'ТОРОПИСЬ · ВЫИГРЫШ '+gain+' МИН':code==='FREE_OPTION'?'БЕСПЛАТНЫЙ ШАНС '+probability+'%':code==='CALM_TIGHT'?'ВНИМАНИЕ · МАЛЫЙ ЗАПАС':'ИДИ СПОКОЙНО';
    var matrix=combos.map(function(c){var x=(c===recommended.code && code==='FREE_OPTION') ? recommended : plans[c];return {code:c,s3:c[0]==='C'?'calm':'fast',s6:c[1]==='C'?'calm':'fast',trainDep:x?time(x.train.dep):'—',homeEta:x?time(x.arrival):'—',departureTime:x?time(x.departure):'—',slackSec:x?x.slack:null,isRecommended:c===recommended.code};});
    var upcoming=(input.direction==='to_home'?all.filter(function(t){return t.dep>=start && t.dep<=start+7200;}):reverse.filter(function(t){return t.dep>=recommended.train.dep-3600 && t.dep<=recommended.train.dep+3600;})).slice(0,12).map(function(t){var status=!t.servesKatuar?'filtered_out':t.uid===cancelledUid?'cancelled':t.dep===recommended.train.dep?'target_fast':t.dep===calm.train.dep?'target_calm':input.direction==='to_home' && t.dep<pre.FF.atPlatform-30?'missed':'upcoming'; return {depTime:time(t.dep),arrTime:t.arr===null?'—':time(t.arr),destination:t.destination,status:status,reason:status==='filtered_out'?'Не доезжает до Катуара':status==='cancelled'?'Рейс отменён':status==='missed'?'Не успеть даже быстро':status==='target_fast'?'Выбранный поезд':status==='target_calm'?'Спокойный вариант':'По расписанию'};});
    return {meta:{calculatedAt:time(start),direction:input.direction,dataSource:flags.apiTimeout||flags.schemaErrorRecovered?'local_cache':'mock_schedule',scheduleUpdatedAt:p.scheduleUpdatedAt,degradationFlags:Object.assign({},flags),warnings:warnings},verdict:{code:code,badgeText:title,headlineEta:time(input.direction==='to_home'?recommended.arrival:recommended.departure),secondaryEtaText:input.direction==='to_home'?'спокойно в '+time(calm.arrival)+(gain?' (Δ '+gain+' мин)':''):'спокойный выход в '+time(calm.departure)+(gain?' · позже на '+gain+' мин':''),summaryAdvice:advice[recommended.code],probabilityPct:probability,savingsMin:gain,activeComboCode:recommended.code,forceCalmApplied:input.forceCalmToday},activePlan:planDto(recommended),comparisonCalmPlan:{comboCode:'CC',arrivalHomeTime:time(calm.arrival),targetTrainDep:time(calm.train.dep),slackSec:calm.slack,nodes:calm.nodes},combinationsMatrix:matrix,upcomingTrains:upcoming};
  }
  var defaultFlags={apiTimeout:false,schemaErrorRecovered:false,staleCache:false,mckHeadwayFallback:false,targetTrainCancelled:false};
  var adapter={load:async function(){var keys=['profile_timings','slack_hints','mock_schedules'], data={}; await Promise.all(keys.map(async function(k){try{if(location.protocol==='file:') throw new Error('file protocol'); var r=await fetch('../config/'+k+'.json'); if(!r.ok)throw new Error('HTTP '+r.status); data[k]=await r.json();}catch(e){data[k]=C.ConfigFallback[k];}})); if(!data.profile_timings.s3 || !Array.isArray(data.slack_hints.hints) || !Array.isArray(data.mock_schedules.okruzhnaya_to_katuar)) data=C.ConfigFallback; return data;}, snapshot:function(data, faults){var flags=Object.assign({},defaultFlags,faults), source=data; if(flags.apiTimeout) source=C.ConfigFallback; if(flags.schemaErrorRecovered){var damaged={okruzhnaya_to_katuar:'invalid',unexpected_field:true}; if(!Array.isArray(damaged.okruzhnaya_to_katuar)) source=C.ConfigFallback;} return {profile:source.profile_timings,hints:source.slack_hints,schedules:source.mock_schedules,flags:flags};}};
  var now=new Date(); var initial={direction:'to_home',baseTime:now.getHours()*3600+now.getMinutes()*60,startOffset:0,busMode:'auto',busWait:3,arriveBy:9*3600,deltaS3:0,deltaS6:0,forceCalmToday:false,faults:Object.assign({},defaultFlags)};
  var ui={activeTheme:'cyber',activeLayout:'focus',expandedNodeId:null,isChaosDrawerOpen:false,showBusSlider:false,showStartSlider:false};
  try{ui.activeTheme=localStorage.getItem('catchit-theme')||ui.activeTheme;ui.activeLayout=localStorage.getItem('catchit-layout')||ui.activeLayout;}catch(e){}
  var data=C.ConfigFallback, listeners=[], dto;
  var store={input:initial,ui:ui,init:async function(){data=await adapter.load();this.recalculate();},recalculate:function(){dto=calculateRoutePlan(initial,adapter.snapshot(data,initial.faults));listeners.forEach(function(f){f(dto,ui,initial);});},subscribe:function(f){listeners.push(f);return function(){listeners=listeners.filter(function(x){return x!==f;});};},getDTO:function(){return dto;},update:function(patch){Object.assign(initial,patch);this.recalculate();},updateUI:function(patch){Object.assign(ui,patch);this.recalculate();}};
  C.RouteEngine={calculateRoutePlan:calculateRoutePlan}; C.RoutePortAdapter=adapter; C.UIViewState=ui; C.store=store; C.util={time:time,parse:parse,duration:dur};
}());
