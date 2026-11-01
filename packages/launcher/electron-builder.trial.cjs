const base = require("./package.json").build

for (const key of ["OPENAGENTS_TRIAL_ORIGIN", "OPENAGENTS_TRIAL_APP_ID", "OPENAGENTS_TRIAL_NAME"]) {
  if (!process.env[key]) throw new Error(`${key} is required for trial packaging`)
}
if (new URL(process.env.OPENAGENTS_TRIAL_ORIGIN).protocol !== "https:") throw new Error("Trial origin must use HTTPS")

module.exports = {
  ...base,
  appId: process.env.OPENAGENTS_TRIAL_APP_ID,
  productName: process.env.OPENAGENTS_TRIAL_NAME,
  artifactName: "${productName}-${version}-${os}-${arch}.${ext}",
  mac: { ...base.mac, identity: "-", notarize: false },
  publish: null,
}
