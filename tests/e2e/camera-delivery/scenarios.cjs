    const extra = () => page.evaluate(() => ({ reads: window.cameraDelivery.permissionReads, requests: window.cameraDelivery.permissionRequests, settings: window.cameraDelivery.settingsCalls, submitted: window.cameraDelivery.submitted }));
    async function target(locator, name) {
      await locator.scrollIntoViewIfNeeded();
      const box = await locator.boundingBox();
      assert.ok(box && box.width >= 44 && box.height >= 44, `${name}: 44px touch target ${JSON.stringify(box)}`);
      assert.ok(box.x >= -1 && box.x + box.width <= page.viewportSize().width + 1, `${name}: within width`);
      report.measurements.push({ name, box });
    }
    async function cameraSetup(scale) {
      await fresh("camera", "checklist", scale); await openChecklist();
      await page.getByRole("radio", { name: "Sí", exact: true }).click();
      await button("Añadir comentario del paso").click();
      await page.getByRole("textbox", { name: "Comentario del paso (opcional)", exact: true }).fill("Borrador sintético que debe conservarse");
      await button("Adjuntar al paso").click(); await button("Guardar archivos · 0").waitFor();
    }
    async function unchangedDraft() {
      await button("Volver al checklist").click(); await heading("¿El equipo está limpio?").waitFor();
      assert.equal(await page.getByRole("radio", { name: "Sí", exact: true }).getAttribute("aria-checked"), "true");
      assert.equal(await page.getByRole("textbox", { name: "Comentario del paso (opcional)", exact: true }).inputValue(), "Borrador sintético que debe conservarse");
      assert.deepEqual((await metrics()).calls, []); assert.deepEqual((await extra()).submitted, []);
    }
    async function flips(name) {
      for (const active of [false, true, false]) {
        await page.evaluate(active => window.pickerOs.lifecycle(active), active); await settle();
        assert.equal((await metrics()).unlocked, false); assert.equal((await os()).prompts, 1);
        await neutralPickerCover(name + (active ? "-active" : "-background"));
      }
      await screenshot(name + "-neutral");
    }
    async function finishCamera(name, cancel = false) {
      await page.evaluate(cancel => window.cameraDelivery.finishCamera(cancel), cancel); await settle();
      assert.equal((await metrics()).unlocked, false, "Result alone cannot release private UI in background");
      await page.evaluate(() => window.pickerOs.lifecycle(true));
      await page.waitForFunction(() => window.pickerMessages.metrics().unlocked);
      await button(`Guardar archivos · ${cancel ? 0 : 1}`).waitFor();
      assert.equal((await os()).prompts, 1); assert.equal((await os()).cameraStarts, 1);
      assert.equal((await os()).cameraSettled, 1); await quiet(name); await screenshot(name + "-returned");
    }
    for (const width of [360, 390]) for (const scale of [1, 2]) {
      const label = `${width}x844-font${scale * 100}`;
      await page.setViewportSize({ width, height: 844 });
      for (const scenario of ["initial-grant", "denied-retry", "permanent-settings", "cancel", "granted-preflight"]) {
        await check(label + "-" + scenario, async () => {
          await cameraSetup(scale); await pickerLabels(label + scenario, scale); await dock(label + scenario, "files-save-dock");
          const before = await metrics();
          await page.evaluate(scenario => {
            window.cameraDelivery.setPermission(scenario === "initial-grant" ? "undetermined" : scenario.includes("denied") || scenario === "permanent-settings" ? "denied" : "granted", scenario !== "permanent-settings");
            window.cameraDelivery.holdProtection = scenario === "granted-preflight";
          }, scenario);
          await button("Cámara").click();
          if (scenario === "initial-grant" || scenario === "denied-retry") {
            await page.waitForFunction(() => window.cameraDelivery.permissionRequests === 1);
            assert.equal((await os()).cameraStarts, 0);
            await page.evaluate(() => window.pickerOs.lifecycle(false)); await settle();
            await page.evaluate(() => window.cameraDelivery.finishPermission(window.cameraDelivery.permission.status === "undetermined"));
            await settle(); assert.equal((await metrics()).unlocked, false);
            await page.evaluate(() => window.pickerOs.lifecycle(true));
            if (scenario === "denied-retry") {
              await heading("Permiso de cámara").waitFor(); await target(button("Reintentar permiso"), label + "-retry");
              await quiet(label + "-permission-guide"); await screenshot(label + "-denied-guide");
              assert.equal((await os()).cameraStarts, 0); assert.equal((await extra()).settings, 0);
              await button("Reintentar permiso").evaluate(element => { element.click(); element.click(); });
              await page.waitForFunction(() => window.cameraDelivery.permissionRequests === 2);
              assert.equal((await extra()).requests, 2, "Double tap creates one retry SDK request");
              await page.evaluate(() => window.cameraDelivery.finishPermission(true));
            }
          }
          if (scenario === "permanent-settings") {
            await heading("Permiso de cámara").waitFor(); await quiet(label + "-permanent-guide");
            assert.equal((await extra()).requests, 0); assert.equal((await extra()).settings, 0); assert.equal((await os()).cameraStarts, 0);
            for (const name of ["Abrir ajustes", "Volver a intentar", "Cancelar"]) await target(button(name), label + name);
            await screenshot(label + "-permanent-guide"); await button("Abrir ajustes").click();
            assert.equal((await extra()).settings, 1);
            await page.evaluate(() => window.pickerOs.lifecycle(false)); await settle();
            assert.equal(Boolean((await metrics()).security.nativeInteractionPending), false);
            await page.evaluate(() => window.pickerOs.lifecycle(true)); await page.waitForFunction(() => window.pickerOs.prompts === 2);
            assert.equal((await metrics()).unlocked, false); assert.equal((await os()).cameraStarts, 0);
            await screenshot(label + "-settings-normal-lock");
            await page.evaluate(() => window.pickerOs.confirm()); await page.waitForFunction(() => window.pickerMessages.metrics().unlocked);
            await heading("Permiso de cámara").waitFor(); assert.equal((await os()).cameraStarts, 0);
            assert.equal((await extra()).requests, 0); await button("Cancelar").click();
            await button("Guardar archivos · 0").waitFor(); await unchangedDraft();
          } else {
            if (scenario === "granted-preflight") {
              await page.waitForFunction(() => window.cameraDelivery.protectionPending);
              assert.equal((await os()).cameraStarts, 0); assert.equal((await extra()).requests, 0);
              await neutralPickerCover(label + "-preflight"); await screenshot(label + "-preflight-await");
              await page.evaluate(() => window.cameraDelivery.releaseProtection());
            }
            await page.waitForFunction(() => window.pickerOs.cameraStarts === 1);
            const events = (await os()).events;
            assert.ok(events.lastIndexOf("protect-ready") < events.indexOf("camera-start") && events.lastIndexOf("protect-ready") >= 0, "Latest protection finishes BEFORE camera SDK");
            await flips(label + scenario); await finishCamera(label + scenario, scenario === "cancel");
            await pickerLabels(label + scenario + "-returned", scale);
            assert.equal((await extra()).requests, scenario === "initial-grant" ? 1 : scenario === "denied-retry" ? 2 : 0);
            await unchangedDraft(); await button("Adjuntar al paso").click(); await button(`Guardar archivos · ${scenario === "cancel" ? 0 : 1}`).waitFor();
          }
          assert.deepEqual((await metrics()).work, before.work);
          report.measurements.push({ name: label + scenario + "-counts", os: await os(), fixture: await extra(), acceptedFiles: scenario === "permanent-settings" || scenario === "cancel" ? 0 : 1 });
        });
      }
      const reasons = {
        pending: "Envía el cambio pendiente de este trabajo y sus archivos compartidos.",
        attention: "Revisa los cambios que requieren atención en el centro de sincronización.",
        offline: "Conéctate a Qualitzer para confirmar la entrega.",
        stale: "Actualiza la ficha para verificar los datos y permisos del trabajo.",
        files: "Actualiza las evidencias para verificar los archivos obligatorios.",
      };
      for (const scenario of [...Object.keys(reasons), "five-reasons", "valid"]) await check(label + "-delivery-" + scenario, async () => {
        await fresh(scenario, "work", scale);
        await button("Entregar trabajo").waitFor(); await target(button("Entregar trabajo"), label + "-review");
        assert.equal(await button("Entregar trabajo").isEnabled(), true);
        await button("Entregar trabajo").click(); await button("Confirmar y entregar").waitFor();
        await settle(); await quiet(label + "-delivery-" + scenario);
        const confirm = button("Confirmar y entregar"); await target(confirm, label + "-confirm-" + scenario);
        await screenshot(label + "-delivery-" + scenario + "-confirm");
        if (scenario === "valid") {
          assert.equal(await confirm.isEnabled(), true);
          await confirm.evaluate(element => { element.click(); element.click(); });
          await page.waitForFunction(() => window.cameraDelivery.submitted.length === 1);
          await settle(); assert.equal((await extra()).submitted.length, 1);
          assert.deepEqual((await extra()).submitted[0], { status: "delivered", executionDates: ["2026-09-14"], isManual: false });
        } else {
          assert.equal(await confirm.isDisabled(), true);
          await confirm.evaluate(element => { element.click(); element.click(); });
          const expected = scenario === "five-reasons" ? [reasons.pending, reasons.attention, reasons.offline, reasons.files, "Completa la información requerida del trabajo y actualiza la ficha."] : [reasons[scenario]];
          for (const reason of expected) { const line = page.getByText("• " + reason, { exact: true }); await line.waitFor(); await line.scrollIntoViewIfNeeded(); }
          const visibleReasons = await page.getByText(/^• /).allTextContents();
          if (scenario === "five-reasons") assert.equal(visibleReasons.length, 5, "Exactly five independent blocking reasons");
          await page.getByText("Antes de entregar", { exact: true }).scrollIntoViewIfNeeded();
          await screenshot(label + "-delivery-" + scenario + "-reasons");
          assert.equal((await extra()).submitted.length, 0);
          report.measurements.push({ name: label + scenario + "-delivery-reasons", reasons: visibleReasons, submitted: 0 });
          await button("Seguir trabajando").click();
        }
        assert.deepEqual((await metrics()).calls, []);
      });
    }