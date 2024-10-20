const { writeFile,readFile } = require("fs/promises");

module.exports = async ({ pkgJsonPath, pkgJson, appDir, hookName }) => {
    /**
     * pkgJsonPath - string - path to the package.json file
     * pkgJson - object - the parsed package.json file
     * appDir - string - the path to the app directory
     * hookName - string - the name of the hook ("todesktop:beforeInstall" or "todesktop:afterPack")
     */
    
    const toDesktopJsonPath = appDir + 'todesktop.json';
    const toDesktopJson = JSON.parse(await readFile(toDesktopJsonPath));
    if (toDesktopJson.id.startsWith('$'))
    {
        const envVarName = toDesktopJson.id.subString(1);
        toDesktopJson.id = process.env[envVarName];
    }
    await writeFile(toDesktopJsonPath, JSON.stringify(toDesktopJson, null, 2));
    
  };