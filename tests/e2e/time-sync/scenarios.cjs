    const wiring = [
      ["src/screens/creation/CreationScreen.tsx", [["Hora de inicio *", 'form.startTime', '(value) => change("startTime", value)'], ["Hora de fin *", 'form.endTime', '(value) => change("endTime", value)']]],
      ["src/screens/workDetail/CompletionDialog.tsx", [["Inicio real (HH:mm)", "start", "(value) => { edited.current = true; setStart(value); }"], ["Término real (HH:mm)", "end", "(value) => { edited.current = true; setEnd(value); }"]]],
      ["src/screens/notifications/NotificationSettingsScreen.tsx", [["Desde", "preferences.quietHoursStart", "(quietHoursStart) => update({ quietHoursStart })"], ["Hasta", "preferences.quietHoursEnd", "(quietHoursEnd) => update({ quietHoursEnd })"]]],
    ];
    report.clockIntegration = [];
    for (const [file, expected] of wiring) {
      const source = ts.createSourceFile(file, fs.readFileSync(path.join(root,file),"utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const fields = [];
      const visit = node => { if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source)==="TimeField") fields.push(node); ts.forEachChild(node,visit); };
      visit(source); assert.equal(fields.length,2);
      for(const [label,value,change] of expected) {
        const field=fields.find(node=>node.attributes.properties.some(prop=>ts.isJsxAttribute(prop)&&prop.name.getText(source)==="label"&&ts.isStringLiteral(prop.initializer)&&prop.initializer.text===label));
        assert.ok(field,label);
        const prop = name => field.attributes.properties.find(prop=>ts.isJsxAttribute(prop)&&prop.name.getText(source)===name)?.initializer;
        assert.equal(prop("value").expression.getText(source),value);
        assert.equal(prop("onChange").expression.getText(source),change);
        assert.ok(prop("scopeKey"));assert.ok(prop("disabled"));assert.equal(prop("onChangeText"),undefined);
        report.clockIntegration.push({file,label,value,onChange:change,verifiedBy:"TypeScript AST + browser full consumer interaction below"});
      }
    }
    assert.equal(report.clockIntegration.length,6);
    assert.equal(report.nativePickerVersion,"9.1.0");
    const trigger = label => page.getByRole("button",{name:new RegExp("^"+label.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+": ")});
    const radio = name => page.getByRole("radio",{name,exact:true});
    async function tapTarget(control, name) {
      await control.scrollIntoViewIfNeeded();
      const box=await control.boundingBox();
      assert.ok(box&&box.width>=44&&box.height>=44, name+": 44px target "+JSON.stringify(box));
      const viewport=page.viewportSize();assert.ok(box.x>=-1&&box.x+box.width<=viewport.width+1,name+": horizontal bounds");
      report.measurements.push({name,box});
    }
    async function panel(name) {
      await button("Confirmar selección").waitFor();await settle();
      await tapTarget(button("Confirmar selección"),name+" confirm");await tapTarget(button("Cancelar"),name+" cancel");
      assert.equal(await button("Confirmar selección").locator("..").getByRole("textbox").count(),0,name+": no keyboard input in picker panel (underlying form may contain unrelated inputs)");
      assert.equal(await page.evaluate(()=>document.activeElement instanceof HTMLInputElement||document.activeElement instanceof HTMLTextAreaElement),false);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    }
    async function stage(hours,minutes) {
      await tapTarget(radio(hours+" h"),"hour "+hours);await radio(hours+" h").click();
      await tapTarget(radio(minutes+" min"),"minute "+minutes);await radio(minutes+" min").click();
      assert.equal(await radio(hours+" h").getAttribute("aria-checked"),"true");
      assert.equal(await radio(minutes+" min").getAttribute("aria-checked"),"true");
    }
    async function clockChange(label,hour,minute) {
      const previous=(await metrics()).clockCalls;
      const originalValue=await trigger(label).getAttribute("aria-label");
      await tapTarget(trigger(label),label);await trigger(label).click();await panel(label);
      assert.equal(await button("Confirmar selección").locator("..").getByRole("radio").count(),84,"24 hours + all 60 minutes in actual selector panel, excluding underlying notification options");
      await stage(hour,minute);assert.deepEqual((await metrics()).clockCalls,previous,"staging never calls consumer onChange");
      await button("Cancelar").click();await trigger(label).waitFor();
      assert.equal(await trigger(label).getAttribute("aria-label"),originalValue);assert.deepEqual((await metrics()).clockCalls,previous,"cancel never calls consumer onChange");
      await trigger(label).click();await stage(hour,minute);await button("Confirmar selección").click();await trigger(label).waitFor();
      assert.equal(await trigger(label).getAttribute("aria-label"),label+": "+hour+":"+minute);
      assert.deepEqual((await metrics()).clockCalls,[...previous,{label,value:hour+":"+minute}],"exactly one original consumer onChange after confirmation");
    }
    for (const width of [360,390,1280]) for(const scale of [1,2]) {
      const label=`${width}x844-font${scale*100}`;await page.setViewportSize({width,height:844});
      await check(label+"-widget-six-values",async()=>{
        await fresh("widget",scale);
        for(const value of ["00:00","00:07","07:07","12:07","23:07","23:59"]) {
          const before=await metrics();await trigger("Reloj").click();await panel(value);
          assert.equal(await page.getByRole("radio").count(),84);
          await stage(...value.split(":"));assert.deepEqual((await metrics()).calls,before.calls);assert.equal((await metrics()).value,before.value);
          await screenshot(label+"-clock-stage-"+value.replace(":","-"));
          await button("Confirmar selección").click();await settle();
          assert.equal((await metrics()).value,value);assert.deepEqual((await metrics()).calls,[...before.calls,{name:"clock",value}]);
        }
        assert.equal((await metrics()).hours,"24");assert.equal((await metrics()).minutes,"49");assert.equal((await metrics()).offset,"1");
      });
      await check(label+"-invalid-original-cancel",async()=>{
        await fresh("invalid",scale);await trigger("Reloj").click();await panel("invalid");
        await page.getByText("El valor anterior no es una hora válida. Solo se reemplaza al confirmar.",{exact:true}).waitFor();
        await stage("23","59");await button("Cancelar").click();await settle();
        assert.equal((await metrics()).value,"invalid-original");assert.deepEqual((await metrics()).calls,[]);
        await screenshot(label+"-invalid-cancel");
      });
      await check(label+"-scope-discards",async()=>{
        await fresh("widget",scale);await trigger("Reloj").click();await stage("23","59");
        await page.evaluate(()=>window.timeSync.scope());await button("Confirmar selección").waitFor({state:"hidden"});
        assert.equal((await metrics()).value,"08:49");assert.deepEqual((await metrics()).calls,[]);
        await trigger("Reloj").click();assert.equal(await radio("08 h").getAttribute("aria-checked"),"true");await button("Cancelar").click();
      });
      await check(label+"-lock-discards",async()=>{
        await fresh("widget",scale);await trigger("Reloj").click();await stage("23","59");
        await page.evaluate(()=>window.pickerOs.lifecycle(false));await page.waitForFunction(()=>!window.timeSync.metrics().unlocked);
        assert.equal(await button("Confirmar selección").isVisible(),false);await screenshot(label+"-locked");
        await page.evaluate(()=>window.pickerOs.lifecycle(true));await page.waitForFunction(()=>window.pickerOs.prompts===2);await page.evaluate(()=>window.pickerOs.confirm());
        await page.waitForFunction(()=>window.timeSync.metrics().unlocked);assert.equal(await button("Confirmar selección").count(),0);
        assert.equal((await metrics()).value,"08:49");assert.deepEqual((await metrics()).calls,[]);
      });
      await check(label+"-numeric-bounded-offset",async()=>{
        await fresh("widget",scale);
        for(const field of ["Horas","Minutos"]) {
          const previousCalls=(await metrics()).calls;
          await trigger(field).click();await panel(field);assert.equal(await page.getByRole("radio").count(),0,"stepper, not an unbounded numeric list");
          await button("Aumentar "+field).click();await button("Cancelar").click();assert.deepEqual((await metrics()).calls,previousCalls);
          await trigger(field).click();await button("Aumentar "+field).click();await button("Confirmar selección").click();
          if(field==="Horas")assert.deepEqual((await metrics()).calls,[{name:"hours",value:"25"}]);
        }
        await trigger("Día de término").click();await radio("Mismo día").click();await button("Confirmar selección").click();
        assert.deepEqual((await metrics()).calls,[{name:"hours",value:"25"},{name:"minutes",value:"50"},{name:"offset",value:"0"}]);
        assert.equal((await metrics()).value,"08:49");await screenshot(label+"-numeric-final");
      });
      await check(label+"-creation-two-real-clocks",async()=>{
        await fresh("creation",scale);await button("Continuar a horario").click();await trigger("Hora de inicio *").waitFor();
        await clockChange("Hora de inicio *","00","07");await clockChange("Hora de fin *","23","59");
        await page.clock.runFor(400);await settle();
        const draft=await page.evaluate(()=>window.timeSync.creation());
        assert.equal(draft.form.startTime,"00:07");assert.equal(draft.form.endTime,"23:59");assert.equal(draft.form.date,"2026-09-14");
        assert.equal(draft.phase,"editing");assert.deepEqual((await metrics()).calls,[]);
        await screenshot(label+"-creation-two-clocks");
      });
      await check(label+"-completion-two-clocks-offset49",async()=>{
        await fresh("completion",scale);await page.getByRole("checkbox",{name:"Editar horas de ejecución manualmente",exact:true}).click();
        await radio("Inicio y término").click();
        await trigger("Día de término").waitFor();assert.match(await trigger("Día de término").getAttribute("aria-label"),/Día siguiente/);
        await page.getByText("24 h 49 min",{exact:true}).waitFor();
        await trigger("Día de término").click();await radio("Mismo día").click();await button("Confirmar selección").click();
        await page.getByText("49 min",{exact:true}).waitFor();assert.match(await trigger("Inicio real (HH:mm)").getAttribute("aria-label"),/08:00$/);assert.match(await trigger("Término real (HH:mm)").getAttribute("aria-label"),/08:49$/);
        await screenshot(label+"-offset49");
        await clockChange("Inicio real (HH:mm)","00","07");await clockChange("Término real (HH:mm)","23","59");
        assert.deepEqual((await metrics()).submitted,[]);await button("Confirmar y entregar").click();await settle();
        assert.deepEqual((await metrics()).submitted,[{status:"delivered",executionDates:["2026-09-14"],isManual:true,executionStartTime:"00:07",executionEndTime:"23:59",endDateOffset:0}]);
      });
      await check(label+"-blocked-stays-blocked",async()=>{
        await fresh("blocked",scale);await page.getByRole("checkbox",{name:"Editar horas de ejecución manualmente",exact:true}).click();
        await radio("Inicio y término").click();
        await trigger("Día de término").click();await radio("Mismo día").click();await button("Confirmar selección").click();
        await page.getByText("49 min",{exact:true}).waitFor();assert.equal(await button("Confirmar y entregar").isDisabled(),true);assert.deepEqual((await metrics()).submitted,[]);
        await screenshot(label+"-cannot-submit");
      });
      await check(label+"-completion-total-correction",async()=>{
        await fresh("completion",scale);
        await tapTarget(button("Confirmar y entregar"),"delivery footer");
        await screenshot(label+"-completion-automatic");
        await page.getByRole("checkbox",{name:"Editar horas de ejecución manualmente",exact:true}).click();
        assert.match(await trigger("Horas trabajadas").getAttribute("aria-label"),/24$/);
        await trigger("Horas trabajadas").click();await radio("8 h").click();await button("Confirmar selección").click();
        await trigger("Minutos trabajados").click();await button("Elegir cero").click();await button("Confirmar selección").click();
        await page.getByText("8 h",{exact:true}).waitFor();await screenshot(label+"-completion-eight-hours");
        await tapTarget(button("Confirmar y entregar"),"corrected footer");
        const box=await button("Confirmar y entregar").boundingBox();assert.ok(box.y+box.height<=844);
        await button("Confirmar y entregar").click();await settle();
        assert.deepEqual((await metrics()).submitted,[{status:"delivered",executionDates:["2026-09-14"],isManual:true,executionStartTime:"08:00",executionEndTime:"16:00",endDateOffset:0}]);
      });
      await check(label+"-confirmed-files-normal-preview",async()=>{
        await fresh("files",scale);
        await button("Ampliar imagen: Evidencia.png").waitFor();
        assert.equal(await button("Ampliar imagen: Evidencia.png").count(),1);
        assert.equal(await page.getByText("Adjuntado por Técnico de prueba",{exact:true}).count(),2);
        assert.equal(await button("Eliminar archivo guardado: Evidencia.png").count(),1);
        const image=page.getByRole("img",{name:"Evidencia.png",exact:true});
        await page.waitForFunction(()=>[...document.images].some(image=>image.complete&&image.naturalWidth>1));
        await screenshot(label+"-confirmed-files");
        await button("Ampliar imagen: Evidencia.png").click();await button("Cerrar imagen").waitFor();
        await screenshot(label+"-confirmed-local-fullscreen");
        await button("Cerrar imagen").click();
        await button("Eliminar archivo guardado: Evidencia.png").click();await button("Cancelar").click();
        assert.deepEqual((await metrics()).submitted,[]);assert.deepEqual((await metrics()).calls,[]);
      });
      await check(label+"-work-actions-complete-create-deliver-reopen",async()=>{
        await fresh("detail",scale);
        await screenshot(label+"-work-compact");
        const footer = page.getByTestId("work-execution-footer");
        const footerBefore = await footer.boundingBox();
        assert.ok(footerBefore && footerBefore.y + footerBefore.height <= 845);
        assert.equal(await page.getByText("Ruedas y torque pernos", {exact:true}).count(), 0);
        assert.equal(await page.getByText("Instrucciones del trabajo", {exact:true}).count(), 0);
        assert.equal(await page.getByTestId("work-materials-section").count(), 0);
        await page.getByRole("tab",{name:"Archivos",exact:true}).click();
        await button("Volver conservando el borrador").click();
        await page.getByTestId("work-activities").waitFor();
        assert.equal((await metrics()).calls.filter(call=>call.name==="back").length,0);
        await button("Completar actividad: Revisar cierre").click();
        await page.waitForFunction(()=>window.timeSync.metrics().calls.some(call=>call.name==="complete"));
        assert.equal(await button("Completar actividad: Revisar cierre").count(),0);
        assert.equal((await footer.boundingBox()).y, footerBefore.y);
        await button("Archivos de actividad: Revisar cierre").click();await page.getByText("Manual del supervisor",{exact:true}).waitFor();
        await screenshot(label+"-activity-supervisor-document");
        await button("Volver a actividades").click();
        await button("Agregar actividad").click();await page.getByRole("textbox",{name:"Nombre de la actividad",exact:true}).fill("Lubricar bisagras");
        assert.equal(await trigger("Horas de actividad").count(),0);
        await page.getByRole("textbox",{name:"Minutos de actividad",exact:true}).fill("90");
        await button("Adjuntar archivos de actividad").click();
        await page.getByText("Ficha.txt",{exact:true}).waitFor();
        await screenshot(label+"-activity-dialog-minutes");
        await button("Guardar actividad").click();
        await page.getByText("Lubricar bisagras",{exact:true}).waitFor();
        await page.getByText("Recién añadida",{exact:true}).waitFor();
        const createdCard = page.getByTestId("activity-card-72");
        await page.waitForFunction(() => { const box=document.querySelector('[data-testid="activity-card-72"]')?.getBoundingClientRect();return box && box.top >= 0 && box.top < innerHeight - 150; });
        await screenshot(label+"-activity-new-highlight");
        const oldCard = await page.getByTestId("activity-card-71").boundingBox();
        assert.ok((await createdCard.boundingBox()).y < oldCard.y);
        assert.deepEqual((await metrics()).calls.filter(call=>call.name==="activity"),[{name:"activity",value:{activity:"Lubricar bisagras",executionTime:90}}]);
        assert.deepEqual((await metrics()).calls.filter(call=>call.name==="upload"),[{name:"upload",value:{id:72,count:1}}]);
        await button("Eliminar actividad: Lubricar bisagras").click();
        await button("Cancelar").click();
        assert.equal((await metrics()).calls.filter(call=>call.name==="delete-activity").length,0);
        await button("Eliminar actividad: Lubricar bisagras").click();
        await button("Eliminar actividad").click();
        await button("Eliminar actividad: Lubricar bisagras").waitFor({state:"hidden"});
        assert.deepEqual((await metrics()).calls.filter(call=>call.name==="delete-activity"),[{name:"delete-activity",value:72}]);
        await screenshot(label+"-activity-created");
        await button("Entregar trabajo").click();await button("Confirmar y entregar").click();
        await page.getByTestId("delivery-success").waitFor();await page.clock.runFor(500);await screenshot(label+"-delivery-success");
        assert.equal((await metrics()).submitted.length,1);
        await button("Consultar detalle").click();await page.getByTestId("work-closed-banner").waitFor();
        await page.getByRole("tab",{name:"Archivos",exact:true}).click();
        assert.equal(await page.getByTestId("work-closed-banner").isVisible(),true);await screenshot(label+"-delivered-files-status");
        await button("Volver conservando el borrador").click();
        await page.getByTestId("work-activities").waitFor();
        assert.equal((await metrics()).calls.filter(call=>call.name==="back").length,0);
        await button("Reabrir trabajo").click();await button("Confirmar reapertura").click();
        await page.getByTestId("work-closed-banner").waitFor({state:"hidden"});
        assert.equal((await metrics()).calls.filter(call=>call.name==="reopen").length,1);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        await screenshot(label+"-work-reopened");
      });
      await check(label+"-notification-two-clocks-no-autosave",async()=>{
        await fresh("notification",scale);await trigger("Desde").waitFor();
        const before=(await metrics()).registrations.length;
        await trigger("Desde").click();await stage("23","59");await button("Cancelar").click();assert.match(await trigger("Desde").getAttribute("aria-label"),/22:00$/);
        await clockChange("Desde","23","59");await clockChange("Hasta","00","07");
        assert.equal((await metrics()).registrations.length,before);assert.equal(await button("Guardar preferencias").isEnabled(),true);
        await screenshot(label+"-quiet-overnight-unsaved");await button("Guardar preferencias").click();
        await page.waitForFunction(count=>window.timeSync.metrics().registrations.length===count+1,before);
        const saved=(await metrics()).registrations.at(-1);assert.equal(saved.quietHoursStart,"23:59");assert.equal(saved.quietHoursEnd,"00:07");
        assert.equal(saved.remindAfterMinutes,30);assert.equal(saved.repeatEveryMinutes,120);assert.deepEqual((await metrics()).calls,[]);
      });
      await check(label+"-maintenance-real-numeric-onchange",async()=>{
        await fresh("maintenance",scale);await trigger("Horas (0–99)").click();await button("Aumentar Horas (0–99)").click();await button("Cancelar").click();assert.deepEqual((await metrics()).calls,[]);
        const before=(await metrics()).draft;
        await trigger("Horas (0–99)").click();await button("Aumentar Horas (0–99)").click();await button("Confirmar selección").click();
        assert.deepEqual((await metrics()).calls,[{name:"maintenance",value:{...before,hours:"25"}}]);
        await trigger("Minutos (0–59)").click();await button("Aumentar Minutos (0–59)").click();await button("Confirmar selección").click();
        assert.deepEqual((await metrics()).calls,[{name:"maintenance",value:{...before,hours:"25"}},{name:"maintenance",value:{...before,hours:"25",minutes:"50"}}]);
        await button("Revisar entrega y firmas").click();await page.getByText(/Falta la firma del técnico/).first().waitFor();assert.equal(await button("Confirmar y entregar OT").count(),0);
        await screenshot(label+"-maintenance-missing-signature");
      });
      for(const entry of ["center","bar"]) await check(label+"-sync-"+entry+"-partial-automatic-uuid",async()=>{
        await fresh("sync",scale);
        if(entry==="center") { await page.getByTestId("connection-status-bar").getByRole("button").first().click();await button("Sincronizar ahora").last().click(); }
        else { await button("Sincronizar ahora").click(); }
        await page.waitForFunction(()=>window.timeSync.metrics().snapshot.pending===2&&!window.timeSync.metrics().snapshot.syncing);
        await page.getByText(/Se enviaron 2 cambios; quedan 2 pendientes/).first().waitFor();
        const partial=await metrics();assert.deepEqual(partial.snapshot.operations.map(op=>op.status),["pending","pending","applied","applied"]);
        assert.equal(partial.snapshot.awaitingDeploymentByKind.timer,2);assert.equal(partial.snapshot.operations[1].attempts,0);
        assert.equal(partial.manualCalls,1);assert.deepEqual(partial.sent.map(op=>op.operationId),[partial.original[0].id,partial.original[2].id]);
        await quiet(label+entry+"-partial");await screenshot(label+"-sync-"+entry+"-partial");
        await page.evaluate(()=>window.timeSync.start());await page.clock.runFor(1);await settle();
        assert.equal((await metrics()).sent.length,2);await page.evaluate(()=>window.timeSync.restore());
        const wait=Math.max(0,(await metrics()).snapshot.operations[0].nextAttemptAt-await page.evaluate(()=>Date.now()));
        await page.clock.runFor(wait+50);await page.waitForFunction(()=>window.timeSync.metrics().snapshot.pending===0);
        const final=await metrics();assert.equal(final.manualCalls,1);assert.equal(final.sent.length,4);assert.deepEqual(final.sent[2],final.sent[0]);assert.equal(final.sent[3].operationId,partial.original[1].id);
        const durable=await page.evaluate(()=>window.timeSync.state());assert.deepEqual(durable.operations.map(op=>[op.id,op.dependencyId,op.createdAt]),partial.original.map(op=>[op.id,op.dependencyId,op.createdAt]));
        assert.ok(durable.operations.every(op=>op.status==="applied"));assert.ok(durable.operations[3].receipt.fileId>0);
        await quiet(label+entry+"-final");assert.doesNotMatch(await page.locator("body").innerText(),/Se enviaron 2 cambios; quedan 2 pendientes|requieren actualizar el servicio/);
        await screenshot(label+"-sync-"+entry+"-automatic-final");await page.evaluate(()=>window.timeSync.stop());
      });
    }