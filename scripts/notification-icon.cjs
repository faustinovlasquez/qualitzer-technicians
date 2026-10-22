// El ícono de notificaciones (símbolo blanco sobre transparente, 96 px) ahora sale del logo oficial junto con los demás.
const { generateBrand } = require("./generate-qualitzer-brand.cjs");

generateBrand().then(
  () => console.log("NOTIFICATION_ICON_96PX_WHITE_ALPHA_READY"),
  () => { console.error("NOTIFICATION_ICON_GENERATION_FAILED"); process.exitCode = 1; }
);
