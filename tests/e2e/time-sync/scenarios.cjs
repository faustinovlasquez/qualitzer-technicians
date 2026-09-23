    const wiring = [
      ["src/screens/creation/CreationScheduleFields.tsx", [["Hora de inicio (opcional)", 'form.startTime', 'value => onChange("startTime", value)'], ["Hora de fin (opcional)", 'form.endTime', 'value => onChange("endTime", value)']]],
      ["src/screens/workDetail/CompletionDialog.tsx", [["Inicio real (HH:mm)", "start", "(value) => { edited.current = true; setStart(value); }"], ["Término real (HH:mm)", "end", "(value) => { edited.current = true; setEnd(value); }"]]],
      ["src/screens/notifications/NotificationSettingsScreen.tsx", [["Desde", "preferences.quietHoursStart", "(quietHoursStart) => update({ quietHoursStart })"], ["Hasta", "preferences.quietHoursEnd", "(quietHoursEnd) => update({ quietHoursEnd })"]]],
    ];
    report.clockIntegration = [];
    for (const [file, expected] of wiring) {
      const source = ts.createSourceFile(file, fs.readFileSync(path.join(root,file),"utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const fields = [];
      const visit = node => { if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source)==="TimeField") fields.push(node); ts.forEachChild(node,visit); };
      visit(source); assert.equal(fields.length,file.endsWith("CompletionDialog.tsx") ? 3 : 2);
      for(const [label,value,change] of expected) {
        const field=fields.find(node=>node.attributes.properties.some(prop=>ts.isJsxAttribute(prop)&&prop.name.getText(source)==="label"&&(ts.isStringLiteral(prop.initializer)?prop.initializer.text===label:ts.isJsxExpression(prop.initializer)&&ts.isConditionalExpression(prop.initializer.expression)&&prop.initializer.expression.whenTrue.text===label)));
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
      await check(`maintenance-dock-${width}-${scale}`, async () => {
        await page.setViewportSize({ width, height: 900 });
        await fresh("maintenance-dock", scale);
        const dock = page.getByTestId("maintenance-action-dock");
        await dock.getByRole("button", { name: "Crear trabajo", exact: true }).waitFor();
        const before = await dock.boundingBox();
        assert(before && before.y + before.height <= 901);
        assert.equal(await page.getByText("Entrega de OT", { exact: true }).count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        await button("Iniciar OT").click();
        await page.getByText("Iniciar OT de mantenimiento", { exact: true }).waitFor();
        await button("Cancelar").last().click();
        await button("Entregar OT").click();
        await page.getByText("Antes de entregar la OT", { exact: true }).waitFor();
        await button("Cancelar").last().click();
        await page.getByRole("tab", { name: "Archivos", exact: true }).click();
        await button("Crear trabajo").waitFor();
        const after = await dock.boundingBox(); assert(after && after.y + after.height <= 901);
        await screenshot(`maintenance-dock-files-${width}-${scale}`);
        await button("Crear trabajo").click();
        await page.getByRole("textbox", { name: "Título *", exact: true }).fill("Trabajo hijo nuevo");
        assert.equal(await button("Asociar equipo").count(), 0);
        await button("Continuar a horario").click(); await button("Revisar creación").click();
        await page.evaluate(() => { window.maintenanceDock.failRead = true; });
        await button("Confirmar y crear").click();
        await page.getByText(/La creación está confirmada. No se pudo abrir/).waitFor();
        assert.equal(await page.evaluate(() => window.maintenanceDock.inputs.length), 1);
        await page.evaluate(() => { window.maintenanceDock.failRead = false; });
        await button("Gestionar trabajo").click();
        await button("Crear trabajo").waitFor();
        await page.getByText("Trabajo hijo nuevo", { exact: true }).waitFor();
        for (const name of ["Iniciar OT", "Entregar OT", "Crear trabajo"]) {
          const fits = await dock.getByRole("button", { name, exact: true }).evaluate(element => {
            const outer = element.getBoundingClientRect();
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
              for (let offset = 0; offset < node.length; offset++) {
                if (!node.textContent[offset].trim()) continue;
                const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + 1);
                for (const rect of range.getClientRects()) if (rect.left < outer.left || rect.right > outer.right || rect.bottom > outer.bottom) return false;
              }
            }
            return true;
          });
          assert.equal(fits, true, name + " text bounds");
        }
        const inputs = await page.evaluate(() => window.maintenanceDock.inputs);
        assert.equal(inputs.length, 1); assert.equal(inputs[0].maintenanceId, 369); assert.equal(inputs[0].work.rentalEquipmentId, undefined);
        await screenshot(`maintenance-dock-created-${width}-${scale}`);
      });
      const label=`${width}x844-font${scale*100}`;await page.setViewportSize({width,height:844});
      await check(label+"-checklist-summary", async () => {
        await fresh("checklist-summary", scale);
        const partial = page.getByTestId("work-checklist-card-81");
        const complete = page.getByTestId("work-checklist-card-82");
        const empty = page.getByTestId("work-checklist-card-83");
        await partial.waitFor();
        assert.match(await partial.textContent(), /4%/);
        assert.match(await partial.textContent(), /2\/46 confirmados · 44 pendientes · Obligatorio/);
        assert.match(await complete.textContent(), /100%/);
        assert.match(await complete.textContent(), /1\/1 confirmados · Completado/);
        assert.match(await empty.textContent(), /Sin pasos/);
        assert.doesNotMatch(await empty.textContent(), /%/);
        if (scale === 1) assert.ok((await partial.boundingBox()).height <= 110, "Compact checklist height");
        for (const card of [partial, complete, empty]) {
          await card.scrollIntoViewIfNeeded();
          const overflow = await card.evaluate(element => {
            const cardBox = element.getBoundingClientRect();
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            const outside = [];
            while (walker.nextNode()) {
              const node = walker.currentNode;
              if (!node.textContent.trim() || getComputedStyle(node.parentElement).fontFamily.includes("ionicons")) continue;
              const range = document.createRange(); range.selectNodeContents(node);
              for (const rect of range.getClientRects()) if (rect.left < cardBox.left - 1 || rect.right > cardBox.right + 1 || rect.top < cardBox.top - 1 || rect.bottom > cardBox.bottom + 1) outside.push(node.textContent);
            }
            return outside;
          });
          assert.deepEqual(overflow, []);
        }
        await partial.scrollIntoViewIfNeeded();
        await screenshot(label+"-checklist-summary-partial");
        await partial.click();
        assert.deepEqual((await metrics()).calls, [{ name: "checklist", value: 81 }]);
        await complete.scrollIntoViewIfNeeded();
        await screenshot(label+"-checklist-summary-complete");
      });
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
      await check(label+"-background-discards",async()=>{
        await fresh("widget",scale);await trigger("Reloj").click();await stage("23","59");
        await page.evaluate(()=>window.pickerOs.lifecycle(false));await page.waitForFunction(()=>!window.timeSync.metrics().unlocked);
        assert.equal(await button("Confirmar selección").isVisible(),false);await screenshot(label+"-locked");
        await page.evaluate(()=>window.pickerOs.lifecycle(true));
        await page.waitForFunction(()=>window.timeSync.metrics().unlocked);assert.equal(await button("Confirmar selección").count(),0);
        assert.equal((await os()).prompts,1);
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
        await fresh("creation",scale);await button("Continuar a horario").click();await trigger("Hora de inicio (opcional)").waitFor();
        await clockChange("Hora de inicio (opcional)","00","07");await clockChange("Hora de fin (opcional)","23","59");
        await page.clock.runFor(400);await settle();
        const draft=await page.evaluate(()=>window.timeSync.creation());
        assert.equal(draft.form.startTime,"00:07");assert.equal(draft.form.endTime,"23:59");assert.equal(draft.form.date,"2026-09-14");
        assert.equal(draft.phase,"editing");assert.deepEqual((await metrics()).calls,[]);
        await screenshot(label+"-creation-two-clocks");
      });
      await check(label+"-creation-only-actionable-conflicts",async()=>{
        for (const screen of ["creation", "creation-empty", "creation-free", "creation-overlap"]) {
          await fresh(screen,scale);await button("Continuar a horario").click();await trigger("Hora de inicio (opcional)").waitFor();
          const warning=page.getByText("Este horario coincide con otros trabajos de tu agenda. Puedes continuar.",{exact:true});
          for (const stage of ["schedule", "review"]) {
            assert.equal(await page.getByText(/cobertura cargada|Datos cargados:|Sin superposiciones|no confirma disponibilidad/).count(),0);
            assert.equal(await warning.count(),screen==="creation-overlap"?1:0);
            if(screen==="creation-overlap")assert.equal(await page.getByText(/Trabajo coincidente/).count(),1);
            const action=button(stage==="schedule"?"Revisar creación":"Confirmar y crear");
            assert.equal(await action.isEnabled(),true);
            await action.scrollIntoViewIfNeeded();
            if(screen==="creation"||screen==="creation-overlap")await screenshot(label+"-"+screen+"-"+stage);
            if(stage==="schedule")await action.click();
          }
          assert.deepEqual((await metrics()).calls,[]);
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        }
      });
      await check(label+"-creation-recovery-allows-another",async()=>{
        for (const screen of ["creation-queued", "creation-applied", "creation-review", "creation-unknown"]) {
          await fresh(screen,scale);
          const title=screen==="creation-queued"?"Guardado · pendiente de sincronizar":screen==="creation-applied"?"Tu planificación está lista":screen==="creation-review"?"Solicitud por revisar":"Solicitud guardada anteriormente";
          await page.getByRole("heading",{name:title,exact:true}).waitFor();
          assert.deepEqual((await metrics()).calls,[]);
          const originalQueue=(await metrics()).creationQueue;
          await button("Crear otro").scrollIntoViewIfNeeded();await screenshot(label+"-"+screen+"-recovered");
          await button("Crear otro").click();await page.getByRole("textbox",{name:"Título *",exact:true}).waitFor();
          assert.equal(await page.getByRole("textbox",{name:"Título *",exact:true}).inputValue(),"");
          const draft=await page.evaluate(()=>window.timeSync.creation());assert.equal(draft.phase,"editing");assert.equal(draft.form.date,"2026-09-14");
          assert.deepEqual((await metrics()).creationQueue,originalQueue);assert.deepEqual((await metrics()).calls,[]);
          if(screen!=="creation-queued")continue;
          for(let index=1;index<=2;index++) {
            await page.getByRole("textbox",{name:"Título *",exact:true}).fill("Otro trabajo "+index);
            await page.getByRole("textbox",{name:"Resumen del trabajo (opcional)",exact:true}).fill("Revision adicional");
            await button("Continuar a horario").click();
            await clockChange("Hora de inicio (opcional)","11","00");await clockChange("Hora de fin (opcional)","12","00");
            await button("Revisar creación").click();
            assert.equal((await metrics()).calls.filter(call=>call.name==="create").length,index-1);
            await button("Confirmar y crear").click();await page.getByRole("heading",{name:"Guardado · pendiente de sincronizar",exact:true}).waitFor();
            const state=await metrics();assert.equal(state.creationQueue.length,index+1);assert.deepEqual(state.creationQueue[0],originalQueue[0]);
            assert.equal(new Set(state.creationQueue.map(operation=>operation.id)).size,index+1);
            if(index===1){await button("Crear otro").click();await page.getByRole("textbox",{name:"Título *",exact:true}).waitFor();}
          }
        }
        await fresh("creation-queued",scale);await page.getByRole("heading",{name:"Guardado · pendiente de sincronizar",exact:true}).waitFor();
        await page.evaluate(()=>window.timeSync.confirmCreation());await button("Ver en mi agenda").waitFor();
        assert.deepEqual((await metrics()).calls,[]);assert.equal((await page.evaluate(()=>window.timeSync.creation())).phase,"confirmed");
        await screenshot(label+"-creation-now-confirmed");
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      });
      await check(label+"-creation-optional-fields",async()=>{
        await fresh("creation",scale);
        await button("Continuar a horario").click();
        await button("Quitar hora de inicio").click();await button("Quitar hora de fin").click();
        await button("Revisar creación").click();await page.getByText(/Sin duración prevista/).waitFor();
        assert.deepEqual((await metrics()).calls,[]);
        await fresh("creation-queued",scale);await button("Crear otro").click();
        await page.getByRole("textbox",{name:"Título *",exact:true}).fill("Trabajo sin horario");
        assert.equal(await page.getByRole("textbox",{name:"Resumen del trabajo (opcional)",exact:true}).inputValue(),"");
        await button("Continuar a horario").click();await screenshot(label+"-creation-optional-schedule");
        await button("Revisar creación").click();await screenshot(label+"-creation-optional-review");
        await button("Confirmar y crear").click();await page.getByRole("heading",{name:"Guardado · pendiente de sincronizar",exact:true}).waitFor();
        const state=await metrics();const operation=state.creationQueue.at(-1);
        assert.equal(operation.input.work.summary,"");
        assert.deepEqual(operation.input.schedule,{date:"2026-09-14",startTime:"",endTime:""});
        assert.equal(state.calls.filter(call=>call.name==="create").length,1);
        await page.evaluate(()=>window.timeSync.confirmCreation());await button("Ver en mi agenda").waitFor();
        assert.equal((await metrics()).calls.filter(call=>call.name==="create").length,1);
        assert.equal((await page.evaluate(()=>window.timeSync.creation())).result.schedule.plannedMinutes,null);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
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
      for (const screen of ["worked-days", "worked-days-manual"]) await check(label+"-"+screen,async()=>{
        await fresh(screen,scale);
        await page.getByRole("checkbox",{name:"Trabajé en varios días",exact:true}).click();
        if(screen==="worked-days-manual")await page.getByRole("checkbox",{name:"Editar horas de ejecución manualmente",exact:true}).click();
        await button("Seleccionar días trabajados").click();
        const day=(number,month="septiembre")=>page.getByRole("checkbox",{name:new RegExp("\\b"+number+" de "+month+" de 2026")});
        await day(15).click();await button("Cancelar").click();
        await button("Seleccionar días trabajados").click();
        assert.equal(await day(15).getAttribute("aria-checked"),"false");
        await day(14).click();assert.equal(await button("Usar fechas seleccionadas").isDisabled(),true);
        for(const date of [15,17,21])await day(date).click();
        assert.equal(await day(16).getAttribute("aria-checked"),"false");
        await screenshot(label+"-"+screen+"-calendar");
        await button("Usar fechas seleccionadas").click();
        await page.getByText("Días trabajados · 3 seleccionado(s)",{exact:true}).waitFor();
        await button("Seleccionar días trabajados").click();await button("Mes anterior").click();await day(29,"agosto").click();
        await button("Mes siguiente").click();
        for(const date of [15,17,21])assert.equal(await day(date).getAttribute("aria-checked"),"true");
        await button("Usar fechas seleccionadas").click();
        await page.getByText("Días trabajados · 4 seleccionado(s)",{exact:true}).waitFor();
        assert.equal(await page.getByRole("radio",{name:"Inicio y término",exact:true}).count(),0);
        assert.deepEqual((await metrics()).submitted,[]);
        await button("Confirmar y entregar").scrollIntoViewIfNeeded();await screenshot(label+"-"+screen+"-review");
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        await button("Confirmar y entregar").click();
        const submitted=(await metrics()).submitted;assert.equal(submitted.length,1);
        assert.deepEqual(submitted[0].workedDates,["2026-08-29","2026-09-15","2026-09-17","2026-09-21"]);
        assert.deepEqual(submitted[0].executionDates,["2026-09-14"]);
        assert.equal(submitted[0].isManual,screen==="worked-days-manual");
        if(screen==="worked-days-manual") {
          assert.equal(submitted[0].executionStartTime,"08:00");assert.equal(submitted[0].executionEndTime,"14:00");assert.equal(submitted[0].endDateOffset,0);
        } else assert.equal(submitted[0].executionStartTime,undefined);
        if(screen==="worked-days") {
          await fresh("creation",scale);await button("Continuar a horario").click();await button("Elegir fecha en calendario").click();
          await page.getByRole("button",{name:/17 de septiembre de 2026/}).click();
          await page.clock.runFor(400);await settle();
          assert.equal((await page.evaluate(()=>window.timeSync.creation())).form.date,"2026-09-17");
          assert.equal(await page.getByRole("heading",{name:"Elegir fecha",exact:true}).count(),0);
        }
      });
      for (const screen of ["offline-clock", "offline-clock-maintenance"]) await check(label+"-"+screen,async()=>{
        await fresh(screen,scale);
        const storageLabel = page.getByTestId("offline-storage-summary");
        await storageLabel.waitFor();
        assert.match(await storageLabel.textContent(), /800.0 MiB usados.*8.0 GiB disponibles/);
        const storageBox = await storageLabel.boundingBox();
        assert.ok(storageBox && storageBox.x >= 0 && storageBox.x + storageBox.width <= width + 1);
        const saved=await page.evaluate(()=>window.timeSync.state());
        await button("Iniciar trabajo").waitFor();await button("Iniciar trabajo").click();await button("Pausar trabajo").waitFor();
        await page.clock.runFor(5100);await settle();
        await page.getByLabel("Tiempo de ejecución: 00:12:05",{exact:true}).waitFor();
        await button("Pausar trabajo").click();await button("Reanudar trabajo").waitFor();
        const before=await page.getByLabel(/^Tiempo de ejecución:/).textContent();
        await page.clock.runFor(3000);await settle();assert.equal(await page.getByLabel(/^Tiempo de ejecución:/).textContent(),before);
        await button("Ver listado de prueba").click();await button("Reanudar").waitFor();
        assert.equal(await button("Reanudar").isEnabled(),true);
        await button("Ver ficha de prueba").click();
        await page.evaluate(()=>window.timeSync.restartTimer());await button("Reanudar trabajo").waitFor();
        assert.equal(await page.getByLabel(/^Tiempo de ejecución:/).textContent(),before);
        await button("Reanudar trabajo").click();await button("Pausar trabajo").waitFor();await page.clock.runFor(2100);await settle();
        await page.getByLabel("Tiempo de ejecución: 00:12:07",{exact:true}).waitFor();
        await button("Pausar trabajo").click();await button("Reanudar trabajo").waitFor();
        await screenshot(label+"-"+screen+"-pending");
        assert.equal(await page.getByText("Guardado local",{exact:true}).count(),1);
        const queued=await page.evaluate(()=>window.timeSync.state());
        assert.equal(queued.operations.filter(operation=>operation.kind==="timer").length,4);
        assert.equal((await metrics()).sent.length,0);
        assert.equal(queued.operations[0].text,"Nota previa conservada");
        assert.deepEqual(queued.cache,saved.cache);
        await button("Reconectar prueba").click();await settle();
        await page.waitForFunction(()=>window.timeSync.metrics().snapshot.operations.every(operation=>operation.status==="applied"));
        assert.equal(await page.getByTestId("offline-storage-summary").count(), 0);
        await page.getByLabel("Tiempo de ejecución: 00:12:07",{exact:true}).waitFor();
        const sent=(await metrics()).sent;assert.equal(sent.filter(command=>command.kind==="timer").length,4);
        assert.equal(sent.filter(command=>command.kind==="comment").length,1);
        await button("Reconectar prueba").click();await settle();assert.equal((await metrics()).sent.length,5);
        await screenshot(label+"-"+screen+"-confirmed");
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      });
      for (const screen of ["offline-clock-completion", "offline-clock-completion-maintenance", "offline-clock-completion-manual", "offline-clock-completion-maintenance-manual"]) await check(label+"-"+screen,async()=>{
        await fresh(screen,scale);
        await button("Reporte técnico").click();
        await page.getByRole("textbox",{name:"Nota del reporte (obligatoria)",exact:true}).fill("Trabajo realizado sin red");
        await button("Guardar reporte").click();await page.getByText("Reporte guardado · pendiente de sincronizar",{exact:true}).waitFor();
        assert.equal(await button("Guardar reporte").isDisabled(),true);
        await button("Iniciar trabajo").click();await button("Pausar trabajo").waitFor();await page.clock.runFor(5100);await settle();
        await button("Pausar trabajo").click();await button("Reanudar trabajo").waitFor();await page.clock.runFor(3000);
        await button("Reanudar trabajo").click();await button("Pausar trabajo").waitFor();await page.clock.runFor(2100);await settle();
        await button("Entregar trabajo").click();await button("Guardar entrega").waitFor();
        assert.equal(await button("Guardar entrega").isEnabled(),true);
        if (screen.endsWith("-manual")) {
          await page.getByRole("checkbox", {name:"Editar horas de ejecución manualmente",exact:true}).click();
          await trigger("Horas trabajadas").click();
          await page.getByRole("radio", {name:"1 h",exact:true}).click(); await button("Confirmar selección").click();
          await trigger("Minutos trabajados").click();
          await button("Elegir cero").click(); await button("Confirmar selección").click();
          assert.equal(await button("Guardar entrega").isEnabled(),true);
        }
        await screenshot(label+"-"+screen+"-review");await button("Guardar entrega").click();
        await page.getByText("Entrega guardada en este dispositivo · pendiente de sincronización.",{exact:true}).waitFor();
        const state=await page.evaluate(()=>window.timeSync.state());
        const closures=state.operations.filter(operation=>operation.kind==="completion");assert.equal(closures.length,1);
        if (screen.endsWith("-manual")) {
          assert.equal(closures[0].localClock.elapsedSeconds, 3600);
          const firstStart = state.operations.find(operation=>operation.kind==="timer" && operation.payload.status==="in_progress");
          assert.ok(firstStart?.payload.recordedAt);
          assert.equal(closures[0].payload.input.executionStartTime, new Intl.DateTimeFormat("en-GB",{timeZone:"America/Santiago",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(firstStart.payload.recordedAt)));
        }
        assert.equal(state.operations.filter(operation=>operation.kind==="timer").length,3);
        await page.getByText("Entregado local · pendiente",{exact:true}).first().waitFor();
        const frozen=await page.getByLabel(/^Tiempo de ejecución:/).textContent();
        await page.clock.runFor(5000);await settle();assert.equal(await page.getByLabel(/^Tiempo de ejecución:/).textContent(),frozen);
        await page.evaluate(()=>window.timeSync.restartTimer());await page.getByText("Entrega guardada en este dispositivo · pendiente de sincronización.",{exact:true}).waitFor();
        assert.equal(await page.getByLabel(/^Tiempo de ejecución:/).textContent(),frozen);
        assert.equal(await button("Iniciar trabajo").count()+await button("Reanudar trabajo").count()+await button("Pausar trabajo").count(),0);
        assert.equal((await metrics()).sent.length,0);
        await button("Ver listado de prueba").click();
        await page.getByText("Entregado local · pendiente",{exact:true}).waitFor();
        await button("Ver ficha de prueba").click();
        await screenshot(label+"-"+screen+"-queued");
        await button("Reconectar prueba").click();await page.waitForFunction(()=>window.timeSync.metrics().snapshot.operations.every(operation=>operation.status==="applied"));await settle();
        assert.equal((await metrics()).sent.filter(command=>command.kind==="completion").length,1);
        assert.equal((await metrics()).sent.filter(command=>command.kind==="comment").length,screen.includes("maintenance")?1:2);
        assert.equal(await page.getByLabel(/^Tiempo de ejecución:/).textContent(),frozen);
        await button("Reconectar prueba").click();await settle();assert.equal((await metrics()).sent.filter(command=>command.kind==="completion").length,1);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
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
      if (report.androidModalUnmount) await check(label+"-activity-picker-existing-modal",async()=>{
        await fresh("detail",scale);
        await button("Archivos de actividad: Revisar cierre").click();
        await button("Subir 0 archivo(s)").waitFor();
        const sources = ["Cámara", "Galería", "Archivos"];
        for (const [index, source] of sources.entries()) {
          await button(source).click();
          if (source === "Cámara") await page.waitForFunction(()=>window.pickerOs.cameraStarts===1);
          else await page.waitForFunction(kind=>window.activityPicker.kind===kind,source==="Galería"?"library":"document");
          await page.waitForFunction(()=>window.timeSync.metrics().unlocked===false);
          assert.equal(await button("Volver a actividades").isVisible(),false);
          await page.evaluate(()=>window.pickerOs.lifecycle(false));
          await settle();
          if (index % 2 === 0) await page.evaluate(()=>window.pickerOs.lifecycle(true));
          await page.evaluate(camera=>camera?window.pickerOs.cameraResult():window.activityPicker.finish(),source==="Cámara");
          if (index % 2 !== 0) await page.evaluate(()=>window.pickerOs.lifecycle(true));
          await button(`Subir ${index+1} archivo(s)`).waitFor();
          assert.equal(await button(`Subir ${index+1} archivo(s)`).isEnabled(),true);
          assert.equal((await metrics()).calls.filter(call=>call.name==="upload").length,0);
          assert.equal((await os()).prompts,1);
        }
        await button("Archivos").click();
        await page.waitForFunction(()=>window.timeSync.metrics().unlocked===false);
        await page.evaluate(()=>window.pickerOs.lifecycle(false));
        await settle();
        await page.evaluate(()=>window.activityPicker.finish(true));
        await page.evaluate(()=>window.pickerOs.lifecycle(true));
        await button("Subir 3 archivo(s)").waitFor();
        for (let transition = 0; transition < 3; transition += 1) {
          await page.evaluate(()=>window.pickerOs.lifecycle(false));
          await settle();
          assert.equal((await metrics()).unlocked,false);
          assert.equal(await button("Subir 3 archivo(s)").isVisible(),false);
          assert.equal(await button("Desbloquear").count(),0);
          await page.evaluate(()=>window.pickerOs.lifecycle(true));
          await button("Subir 3 archivo(s)").waitFor();
          assert.equal((await metrics()).unlocked,true);
          assert.equal((await os()).prompts,1);
          assert.equal((await metrics()).calls.filter(call=>call.name==="upload").length,0);
        }
        await screenshot(label+"-activity-picker-prepared");
        await button("Volver a actividades").click();
        await button("Archivos de actividad: Revisar cierre").click();
        await button("Subir 3 archivo(s)").waitFor();
        await button("Subir 3 archivo(s)").click();
        await button("Subir 0 archivo(s)").waitFor();
        assert.deepEqual((await metrics()).calls.filter(call=>call.name==="upload"),[1,2,3].map(()=>({name:"upload",value:{id:71,count:1}})));
        await button("Volver a actividades").click();
        await button("Archivos de actividad: Revisar cierre").click();
        await page.getByText("Documento.pdf",{exact:true}).waitFor();
        assert.equal(await button("Subir 0 archivo(s)").isEnabled(),false);
        assert.equal(await page.getByText("galeria.png",{exact:true}).count(),1);
        assert.equal(await page.getByText("camara-simulada.png",{exact:true}).count(),1);
        await screenshot(label+"-activity-picker-confirmed");
        await page.reload();
        await page.waitForFunction(()=>window.pickerOs?.prompts===1);
        assert.equal(await button("Archivos de actividad: Revisar cierre").count(),0);
        await page.evaluate(()=>window.pickerOs.confirm());
        await page.waitForFunction(()=>window.timeSync.metrics().unlocked===true);
      });
      await check(label+"-profile-signatures-create-edit-use",async()=>{
        await fresh("signatures",scale);
        await button("Configurar mis firmas").click();
        await page.getByText("Sin firmas configuradas",{exact:true}).waitFor();
        await button("Agregar firma").click();
        await page.getByRole("textbox",{name:"Nombre en firma",exact:true}).fill("Luis Roca");
        await page.getByRole("textbox",{name:"Correo en firma",exact:true}).fill("luis@example.invalid");
        const canvas=page.locator("canvas");
        await canvas.scrollIntoViewIfNeeded();
        const box=await canvas.boundingBox();assert.ok(box&&box.width>100&&box.height>100);
        await page.mouse.move(box.x+20,box.y+100);await page.mouse.down();
        await page.mouse.move(box.x+70,box.y+35,{steps:12});await page.mouse.move(box.x+120,box.y+110,{steps:12});await page.mouse.up();
        const nonWhite=await canvas.evaluate(element=>{const bytes=element.getContext("2d").getImageData(0,0,element.width,element.height).data;let count=0;for(let index=0;index<bytes.length;index+=4){if(bytes[index]<100&&bytes[index+2]>100)count++;}return count;});
        assert.ok(nonWhite>50,"Real signature canvas has drawn pixels");
        await screenshot(label+"-profile-signature-drawn");
        await button("Guardar firma").click();
        await button("Editar firma: Luis Roca").waitFor();
        const original=(await metrics()).profileSignatures[0];assert.match(original.signatureImage,/^data:image\/png;base64,/);assert.equal(original.isDefaultForBranch,true);
        await button("Editar firma: Luis Roca").click();
        await page.getByRole("textbox",{name:"Nombre en firma",exact:true}).fill("Luis Roca - Taller");
        await button("Guardar firma").click();await button("Editar firma: Luis Roca - Taller").waitFor();
        assert.equal((await metrics()).profileSignatures[0].id,original.id);assert.equal((await metrics()).profileSignatures[0].signatureImage,original.signatureImage);
        await button("Agregar firma").click();
        await page.getByRole("textbox",{name:"Nombre en firma",exact:true}).fill("Luis Roca - Faena");
        await page.getByRole("checkbox",{name:"Faena",exact:true}).click();
        await button("Cargar imagen").click();await page.getByRole("img",{name:"Imagen de firma guardada",exact:true}).waitFor();
        await button("Guardar firma").click();await button("Editar firma: Luis Roca - Faena").waitFor();
        assert.equal((await metrics()).profileSignatures.length,2);
        assert.match((await metrics()).profileSignatures[1].signatureImage,/^data:image\/png;base64,/);
        await screenshot(label+"-profile-signature-list");
        await button("Cerrar mis firmas").click();await button("Preparar OT de prueba").click();
        await page.getByRole("img",{name:"Firma del tecnico desde el perfil",exact:true}).waitFor();
        assert.equal((await metrics()).draft.technicianProfileSignature.id,original.id);
        await button("Mis firmas: elegir, agregar o editar").scrollIntoViewIfNeeded();
        await screenshot(label+"-delivery-default-signature");
        await button("Dibujar firma").click();assert.equal((await metrics()).draft.technicianProfileSignature,null);
        await button("Mis firmas: elegir, agregar o editar").click();await button("Editar firma: Luis Roca - Faena").waitFor();
        await button("Usar firma").nth(1).click();await page.getByRole("img",{name:"Firma del tecnico desde el perfil",exact:true}).waitFor();
        assert.equal((await metrics()).draft.technicianProfileSignature.name,"Luis Roca - Faena");
        await button("Mis firmas: elegir, agregar o editar").click();await button("Editar firma: Luis Roca - Faena").click();
        await page.getByRole("textbox",{name:"Nombre en firma",exact:true}).fill("Luis Roca - Faena editada");
        await button("Guardar firma").click();await button("Editar firma: Luis Roca - Faena editada").waitFor();
        await button("Cerrar mis firmas").click();
        await page.getByText("Firma del tecnico · Luis Roca - Faena editada",{exact:true}).waitFor();
        assert.equal((await metrics()).signatureDeliveries.length,0);
        await screenshot(label+"-delivery-signature-compact");
        await button("Entregar OT en demo").click();
        assert.equal((await metrics()).signatureDeliveries.length,1);
        assert.equal((await metrics()).signatureDeliveries[0].clientSignature,null);
        assert.equal((await metrics()).signatureDeliveries[0].acknowledgeDelivery,true);
        await button("Configurar mis firmas").click();await button("Eliminar firma: Luis Roca - Faena editada").click();await button("Cancelar eliminacion").click();
        assert.equal((await metrics()).profileSignatures.length,2);
        await button("Eliminar firma: Luis Roca - Faena editada").click();await button("Confirmar eliminacion de firma").click();
        await button("Editar firma: Luis Roca - Faena editada").waitFor({state:"hidden"});assert.equal((await metrics()).profileSignatures.length,1);
        assert.equal((await metrics()).signatureDeliveries.length,1);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      });
      await check(label+"-profile-signatures-technical-preflight",async()=>{
        await fresh("technical-delivery",scale);
        const filesBox=await button("Archivos del mantenimiento").boundingBox();
        const deliveryBox=await button("Entregar OT").boundingBox();
        assert.ok(filesBox&&deliveryBox&&deliveryBox.y>=filesBox.y+filesBox.height);
        assert.equal(await button("Entregar OT").evaluate(element=>getComputedStyle(element).backgroundColor),"rgb(196, 81, 10)");
        await button("Entregar OT").click();await button("Entendido, continuar").waitFor();
        await page.getByText("2 trabajo(s) sin entregar",{exact:true}).waitFor();
        await page.getByText("2 checklist(s) incompleto(s)",{exact:true}).waitFor();
        assert.equal(await page.getByRole("textbox",{name:"Nota técnica",exact:true}).count(),0);
        assert.equal((await metrics()).signatureDeliveries.length,0);
        await screenshot(label+"-technical-preflight");
        await button("Cancelar").click();await settle();assert.equal((await metrics()).signatureDeliveries.length,0);
        assert.equal(await button("Entendido, continuar").count(),0);
        await button("Entregar OT").click();await button("Entendido, continuar").click();
        await page.getByRole("textbox",{name:"Nota técnica",exact:true}).fill("Se entrega con revisión pendiente.");
        assert.equal(await page.getByText("Tipo de falla *",{exact:true}).count(),0);
        assert.equal(await page.getByRole("textbox",{name:"Nombre de quien recibe *",exact:true}).count(),0);
        await button("Entregar OT").last().click();await page.getByText(/Falta la firma del técnico/).first().waitFor();
        assert.equal((await metrics()).signatureDeliveries.length,0);
        const canvas=page.locator("canvas");await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();
        assert.ok(box&&box.height>80);await page.mouse.move(box.x+20,box.y+80);await page.mouse.down();await page.mouse.move(box.x+70,box.y+30,{steps:12});await page.mouse.move(box.x+130,box.y+90,{steps:12});await page.mouse.up();
        await screenshot(label+"-technical-form");
        await button("Entregar OT").last().click();await page.getByText("Entrega de la OT confirmada.",{exact:true}).waitFor();
        const delivery=(await metrics()).signatureDeliveries;assert.equal(delivery.length,1);assert.equal(delivery[0].note,"Se entrega con revisión pendiente.");assert.equal(delivery[0].durationMinutes,35);assert.equal(delivery[0].acknowledgeDelivery,true);assert.equal(delivery[0].clientSignature,null);assert.equal(delivery[0].faultType,null);
        await fresh("technical-ready",scale);await button("Sí, entregar OT").waitFor();
        await page.getByText("Ya tienes todo listo para entregar la OT. ¿Quieres hacerlo ahora?",{exact:true}).waitFor();await screenshot(label+"-technical-ready");
        await button("Más tarde").click();await button("Actualizar estado de OT").click();await settle();assert.equal(await button("Sí, entregar OT").count(),0);
        assert.equal((await metrics()).signatureDeliveries.length,0);
      });
      await check(label+"-file-deletion-confirmed-versus-rejected",async()=>{
        for (const screen of ["file-delete", "file-delete-refresh-fails", "file-delete-rejected"]) {
          await fresh(screen,scale);
          const remove=button("Eliminar archivo guardado: Evidencia.png");
          await remove.click();await button("Cancelar").click();
          assert.equal((await metrics()).calls.length,0);
          await remove.click();await button("Confirmar eliminación").click();
          if(screen==="file-delete-rejected") {
            await page.getByText(/No se confirmó la eliminación/).last().waitFor();
            await button("Cancelar").click();
            await remove.waitFor();
            assert.equal(await remove.isVisible(),true);
          } else {
            await remove.waitFor({state:"hidden"});
            await page.getByText(screen==="file-delete"?"Archivo eliminado.":"El archivo se eliminó, pero no se pudo actualizar la lista. Actualízala; no repitas la eliminación.",{exact:true}).waitFor();
            await page.clock.runFor(500);await settle();
            assert.equal(await page.getByText("Evidencia.png",{exact:true}).isVisible(),false);
            assert.equal(await button("Confirmar eliminación").isVisible(),false);
            assert.equal(await page.getByText("Conservar.pdf",{exact:true}).count(),1);
          }
          assert.deepEqual((await metrics()).calls,[{name:"delete-file",value:"43"}]);
          await screenshot(label+"-"+screen);
        }
      });
      await check(label+"-order-files-autosave-home-menu",async()=>{
        async function verifyFilesLayout(stage) {
          const tabs=await page.getByRole("tablist",{name:"Secciones de la orden",exact:true}).boundingBox();
          const toolbar=await page.getByTestId("files-toolbar").boundingBox();
          const list=await page.getByTestId("files-list-scroll").boundingBox();
          const dock=await page.getByTestId("files-save-dock").boundingBox();
          report.measurements.push({name:label+"-"+stage,tabs,toolbar,list,dock});
          assert.ok(tabs&&toolbar&&list&&dock);
          const gap=toolbar.y-tabs.y-tabs.height;
          assert.ok(gap>=0&&gap<=16,`Files toolbar must follow tabs, not an empty refresh wrapper: ${gap}px`);
          assert.ok(list.height>=190,`Image viewport compressed to ${list.height}px`);
          assert.ok(Math.abs(list.y-toolbar.y-toolbar.height)<2);
          assert.ok(Math.abs(dock.y-list.y-list.height)<2);
          assert.ok(Math.abs(dock.y+dock.height-page.viewportSize().height)<2);
        }
        async function verifyImageVisible(preview,stage) {
          await preview.scrollIntoViewIfNeeded();
          const image=await preview.boundingBox();
          const viewport=await page.getByTestId("files-list-scroll").boundingBox();
          assert.ok(image&&viewport);
          const visibleHeight=Math.max(0,Math.min(image.y+image.height,viewport.y+viewport.height)-Math.max(image.y,viewport.y));
          assert.ok(visibleHeight>=140,`Only ${visibleHeight}px of image visible at ${stage}`);
          const pixels=await preview.evaluate(element=>{
            const bitmap=element.matches("img")?element:element.querySelector("img");
            if(!bitmap?.complete||!bitmap.naturalWidth)return null;
            const canvas=document.createElement("canvas");canvas.width=32;canvas.height=32;
            const context=canvas.getContext("2d");context.drawImage(bitmap,0,0,32,32);
            const data=context.getImageData(0,0,32,32).data;
            return {width:bitmap.naturalWidth,height:bitmap.naturalHeight,colors:new Set(Array.from({length:1024},(_,index)=>data.slice(index*4,index*4+4).join(","))).size};
          });
          assert.ok(pixels&&pixels.width>0&&pixels.height>0&&pixels.colors>1,`Missing or blank image at ${stage}`);
          await screenshot(label+"-"+stage+"-image-visible");
        }
        for (const screen of ["order-files", "order-files-queued", "order-files-error"]) {
          await fresh(screen,scale);
          await page.getByText("13 confirmados · 0 en cola",{exact:true}).waitFor();
          await verifyFilesLayout(screen+"-initial");
          const beforeDock=await page.getByTestId("files-save-dock").boundingBox();
          assert.ok(beforeDock&&Math.abs(beforeDock.y+beforeDock.height-page.viewportSize().height)<2);
          await button("Opciones de la orden").click();
          await button("Trabajos").waitFor();
          assert.equal((await metrics()).calls.length,0);
          await screenshot(label+"-order-menu");
          await button("Trabajos").click();
          await button("Opciones de la orden").click();
          await button("Archivos").last().click();
          await page.getByTestId("files-save-dock").waitFor();
          await verifyFilesLayout(screen+"-from-works");
          await button("Cámara").click();await page.waitForFunction(()=>window.pickerOs.cameraStarts===1);
          await page.evaluate(()=>window.pickerOs.lifecycle(false));
          await page.evaluate(()=>window.pickerOs.cameraResult());
          await page.evaluate(()=>window.pickerOs.lifecycle(true));
          await page.waitForFunction(()=>window.timeSync.metrics().calls.some(call=>call.name==="order-upload"));
          assert.equal(await button("Ir a mi jornada").isDisabled(),true);
          assert.equal(await button("Opciones de la orden").isDisabled(),true);
          const afterDock=await page.getByTestId("files-save-dock").boundingBox();
          assert.ok(afterDock&&Math.abs(afterDock.y+afterDock.height-page.viewportSize().height)<2,JSON.stringify(afterDock));
          await page.evaluate(()=>window.timeSync.releaseOrderUpload());
          if(screen==="order-files-error") {
            await page.getByText(/No se pudo guardar el archivo de prueba/).waitFor();
            await page.getByText(/1 sin guardar/).waitFor();
            const draftTile=button("Ampliar archivo pendiente: camara-simulada.png");
            await draftTile.waitFor();assert.ok((await draftTile.boundingBox()).height>=140);
            await verifyFilesLayout(screen+"-pending");
            await verifyImageVisible(draftTile,screen+"-pending");
          } else if(screen==="order-files-queued") {
            await page.getByText("13 confirmados · 1 en cola",{exact:true}).waitFor();
            const preview=page.getByRole("img",{name:"Vista previa pendiente: camara-simulada.png",exact:true});
            await preview.waitFor();assert.ok((await preview.boundingBox()).height>=140);
            await verifyFilesLayout(screen+"-queued");
            await verifyImageVisible(preview,screen+"-queued");
            await screenshot(label+"-order-file-queued");
            await page.evaluate(()=>window.timeSync.confirmOrderFiles());
            await page.getByText("14 confirmados · 0 en cola",{exact:true}).waitFor();
          } else await page.getByText("14 confirmados · 0 en cola",{exact:true}).waitFor();
          assert.equal((await metrics()).calls.filter(call=>call.name==="order-upload").length,1);
          if(screen!=="order-files-error")await verifyImageVisible(button("Ampliar imagen: camara-simulada.png"),screen+"-saved");
          await screenshot(label+"-"+screen);
          await button("Opciones de la orden").click();await button("Trabajos").click();
          await page.getByRole("tab",{name:"Archivos",exact:true}).click();
          await page.getByText(screen==="order-files-error"?/1 sin guardar/:"14 confirmados · 0 en cola").waitFor();
          await verifyFilesLayout(screen+"-return");
          assert.equal((await metrics()).calls.filter(call=>call.name==="order-upload").length,1,"Opening files does not replay drafts");
          await button("Ir a mi jornada").click();
          assert.equal((await metrics()).calls.filter(call=>call.name==="order-home").length,1);
          assert.equal((await metrics()).calls.filter(call=>call.name==="order-back").length,0);
        }
      });
      await check(label+"-work-actions-delete-activity-file",async()=>{
        for (const outcome of ["success", "rejected", "refresh-fails"]) {
          await fresh("detail",scale);
          await page.evaluate(outcome=>window.timeSync.activityDeletionCase(outcome),outcome);
          await button("Archivos de actividad: Revisar cierre").click();
          const remove=button("Eliminar archivo guardado: Foto de actividad.png");
          await remove.waitFor();
          assert.equal(await button("Eliminar archivo guardado: manual.pdf").count(),0);
          await remove.scrollIntoViewIfNeeded();await screenshot(label+"-activity-delete-"+outcome+"-before");
          await remove.click();await button("Cancelar").click();assert.equal((await metrics()).calls.length,0);
          await remove.click();await button("Confirmar eliminación").click();
          if(outcome==="rejected") {
            await page.getByText(/No se confirmó la eliminación/).last().waitFor();
            await button("Cancelar").click();await remove.waitFor();
          } else {
            await remove.waitFor({state:"hidden"});
            await page.getByText(outcome==="success"?"Archivo eliminado.":"El archivo se eliminó, pero no se pudo actualizar la lista. Actualízala; no repitas la eliminación.",{exact:true}).waitFor();
          }
          assert.deepEqual((await metrics()).calls,[{name:"delete-activity-file",value:{id:71,fileId:"401"}}]);
          assert.equal(await button("Eliminar archivo guardado: Otra foto.png").count(),1);
          await screenshot(label+"-activity-delete-"+outcome+"-after");
          await button("Volver a actividades").click();await button("Archivos de actividad: Revisar cierre").click();
          if(outcome!=="refresh-fails") {
            await page.getByText(outcome==="success"?"1 confirmados · 0 en cola":"2 confirmados · 0 en cola",{exact:true}).waitFor();
            assert.equal(await remove.count(),outcome==="success"?0:1);
          }
          assert.equal((await metrics()).calls.length,1);
        }
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
        await button("Más secciones del trabajo").click();
        await button("Equipo").click();
        await page.getByRole("tab",{name:"Equipo",exact:true}).waitFor();
        assert.equal((await metrics()).calls.filter(call=>call.name==="back").length,0);
        await button("Más secciones del trabajo").click();
        await button("Checklist").click();
        assert.equal(await footer.count(),0);
        await page.getByRole("tab",{name:"Archivos",exact:true}).click();
        assert.equal(await footer.count(),0);
        await button("Ir al inicio del trabajo").click();
        await page.getByTestId("work-activities").waitFor();
        assert.equal((await metrics()).calls.filter(call=>call.name==="back").length,0);
        await page.getByRole("checkbox",{name:"Marcar lista: Revisar cierre",exact:true}).click();
        await page.waitForFunction(()=>window.timeSync.metrics().calls.some(call=>call.name==="complete"));
        const checked = page.getByRole("checkbox",{name:"Marcar pendiente: Revisar cierre",exact:true});
        assert.equal(await checked.getAttribute("aria-checked"),"true");
        await checked.click();
        await page.getByRole("checkbox",{name:"Marcar lista: Revisar cierre",exact:true}).waitFor();
        await button("Editar actividad: Revisar cierre").click();
        await page.getByRole("textbox",{name:"Nombre de la actividad",exact:true}).fill("Revisar cierre ajustado");
        await page.getByRole("textbox",{name:"Minutos de actividad",exact:true}).fill("45");
        await button("Guardar cambios").click();
        await page.getByText("Revisar cierre ajustado",{exact:true}).waitFor();
        assert.deepEqual((await metrics()).calls.filter(call=>call.name==="edit-activity"),[{name:"edit-activity",value:{id:71,activity:"Revisar cierre ajustado",executionTime:45}}]);
        await screenshot(label+"-activity-compact-edited");
        if(scale===1) assert.ok((await page.getByTestId("activity-card-71").boundingBox()).height < 150);
        assert.equal((await footer.boundingBox()).y, footerBefore.y);
        await button("Archivos de actividad: Revisar cierre ajustado").click();await page.getByText("Manual del supervisor",{exact:true}).waitFor();
        assert.equal(await footer.count(),0);
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
        await button("Archivos de actividad: Lubricar bisagras").click();
        assert.equal(await footer.count(),0);
        await page.getByText("Ficha.txt",{exact:true}).waitFor();
        await button("Volver a actividades").click();
        await button("Archivos de actividad: Lubricar bisagras").click();
        await page.getByText("Ficha.txt",{exact:true}).waitFor();
        await button("Volver a actividades").click();
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
        await button("Entregar OT").click();await page.getByText(/Falta la firma del técnico/).first().waitFor();assert.equal((await metrics()).signatureDeliveries.length,0);
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