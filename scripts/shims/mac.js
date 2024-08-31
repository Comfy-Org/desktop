"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNotarizeOpts = exports.createSignOpts = exports.filterCFBundleIdentifier = exports.App = exports.MacApp = void 0;
const platform_1 = require("./platform");
const common_1 = require("./common");
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
const plist_1 = __importDefault(require("plist"));
const notarize_1 = require("@electron/notarize");
const osx_sign_1 = require("@electron/osx-sign");
class MacApp extends platform_1.App {
    constructor(opts, templatePath) {
        super(opts, templatePath);
        this.appName = opts.name;
    }
    get appCategoryType() {
        return this.opts.appCategoryType;
    }
    get appCopyright() {
        return this.opts.appCopyright;
    }
    get appVersion() {
        return this.opts.appVersion;
    }
    get buildVersion() {
        return this.opts.buildVersion;
    }
    get enableDarkMode() {
        return this.opts.darwinDarkModeSupport;
    }
    get usageDescription() {
        return this.opts.usageDescription;
    }
    get protocols() {
        return (this.opts.protocols || []).map((protocol) => {
            return {
                CFBundleURLName: protocol.name,
                CFBundleURLSchemes: [...protocol.schemes],
            };
        });
    }
    get dotAppName() {
        return `${(0, common_1.sanitizeAppName)(this.appName)}.app`;
    }
    get defaultBundleName() {
        return `com.electron.${(0, common_1.sanitizeAppName)(this.appName).toLowerCase()}`;
    }
    get bundleName() {
        return filterCFBundleIdentifier(this.opts.appBundleId || this.defaultBundleName);
    }
    get originalResourcesDir() {
        return path_1.default.join(this.contentsPath, 'Resources');
    }
    get resourcesDir() {
        return path_1.default.join(this.dotAppName, 'Contents', 'Resources');
    }
    get electronBinaryDir() {
        return path_1.default.join(this.contentsPath, 'MacOS');
    }
    get originalElectronName() {
        return 'Electron';
    }
    get newElectronName() {
        return this.appPlist.CFBundleExecutable;
    }
    get renamedAppPath() {
        return path_1.default.join(this.stagingPath, this.dotAppName);
    }
    get electronAppPath() {
        return path_1.default.join(this.stagingPath, `${this.originalElectronName}.app`);
    }
    get contentsPath() {
        return path_1.default.join(this.electronAppPath, 'Contents');
    }
    get frameworksPath() {
        return path_1.default.join(this.contentsPath, 'Frameworks');
    }
    get loginItemsPath() {
        return path_1.default.join(this.contentsPath, 'Library', 'LoginItems');
    }
    get loginHelperPath() {
        return path_1.default.join(this.loginItemsPath, 'Electron Login Helper.app');
    }
    updatePlist(basePlist, displayName, identifier, name) {
        return Object.assign(basePlist, {
            CFBundleDisplayName: displayName,
            CFBundleExecutable: (0, common_1.sanitizeAppName)(displayName),
            CFBundleIdentifier: identifier,
            CFBundleName: (0, common_1.sanitizeAppName)(name),
        });
    }
    updateHelperPlist(helperPlist, suffix, identifierIgnoresSuffix) {
        let helperSuffix, identifier, name;
        if (suffix) {
            helperSuffix = `Helper ${suffix}`;
            if (identifierIgnoresSuffix) {
                identifier = this.helperBundleIdentifier;
            }
            else {
                identifier = `${this.helperBundleIdentifier}.${suffix}`;
            }
            name = `${this.appName} ${helperSuffix}`;
        }
        else {
            helperSuffix = 'Helper';
            identifier = this.helperBundleIdentifier;
            name = this.appName;
        }
        return this.updatePlist(helperPlist, `${this.appName} ${helperSuffix}`, identifier, name);
    }
    async extendPlist(basePlist, propsOrFilename) {
        if (!propsOrFilename) {
            return Promise.resolve();
        }
        if (typeof propsOrFilename === 'string') {
            const plist = await this.loadPlist(propsOrFilename);
            return Object.assign(basePlist, plist);
        }
        else {
            return Object.assign(basePlist, propsOrFilename);
        }
    }
    async loadPlist(filename, propName) {
        const loadedPlist = plist_1.default.parse((await fs_extra_1.default.readFile(filename)).toString());
        if (propName) {
            this[propName] = loadedPlist;
        }
        return loadedPlist;
    }
    ehPlistFilename(helper) {
        return this.helperPlistFilename(path_1.default.join(this.frameworksPath, helper));
    }
    helperPlistFilename(helperApp) {
        return path_1.default.join(helperApp, 'Contents', 'Info.plist');
    }
    async determinePlistFilesToUpdate() {
        const appPlistFilename = path_1.default.join(this.contentsPath, 'Info.plist');
        const plists = [
            [appPlistFilename, 'appPlist'],
            [this.ehPlistFilename('Electron Helper.app'), 'helperPlist'],
        ];
        const possiblePlists = [
            [this.ehPlistFilename('Electron Helper (Renderer).app'), 'helperRendererPlist'],
            [this.ehPlistFilename('Electron Helper (Plugin).app'), 'helperPluginPlist'],
            [this.ehPlistFilename('Electron Helper (GPU).app'), 'helperGPUPlist'],
            [this.ehPlistFilename('Electron Helper EH.app'), 'helperEHPlist'],
            [this.ehPlistFilename('Electron Helper NP.app'), 'helperNPPlist'],
            [this.helperPlistFilename(this.loginHelperPath), 'loginHelperPlist'],
        ];
        const optional = await Promise.all(possiblePlists.map(async (item) => (await fs_extra_1.default.pathExists(item[0])) ? item : null));
        return [...plists, ...optional.filter(item => item)];
    }
    appRelativePath(p) {
        return path_1.default.relative(this.contentsPath, p);
    }
    async updatePlistFiles() {
        const appBundleIdentifier = this.bundleName;
        this.helperBundleIdentifier = filterCFBundleIdentifier(this.opts.helperBundleId || `${appBundleIdentifier}.helper`);
        const plists = await this.determinePlistFilesToUpdate();
        await Promise.all(plists.map(plistArgs => this.loadPlist(...plistArgs)));
        await this.extendPlist(this.appPlist, this.opts.extendInfo);
        if (this.asarIntegrity) {
            await this.extendPlist(this.appPlist, {
                ElectronAsarIntegrity: this.asarIntegrity,
            });
        }
        else {
            delete this.appPlist?.ElectronAsarIntegrity;
        }
        this.appPlist = this.updatePlist(this.appPlist, this.executableName, appBundleIdentifier, this.appName);
        const updateIfExists = [
            ['helperRendererPlist', '(Renderer)', true],
            ['helperPluginPlist', '(Plugin)', true],
            ['helperGPUPlist', '(GPU)', true],
            ['helperEHPlist', 'EH'],
            ['helperNPPlist', 'NP'],
        ];
        for (const [plistKey] of [...updateIfExists, ['helperPlist']]) {
            if (!this[plistKey]) {
                continue;
            }
            await this.extendPlist(this[plistKey], this.opts.extendHelperInfo);
        }
        this.helperPlist = this.updateHelperPlist(this.helperPlist);
        for (const [plistKey, ...suffixArgs] of updateIfExists) {
            if (!this[plistKey]) {
                continue;
            }
            this[plistKey] = this.updateHelperPlist(this[plistKey], ...suffixArgs);
        }
        // Some properties need to go on all helpers as well, version, usage info, etc.
        const plistsToUpdate = updateIfExists
            .filter(([key]) => !!this[key])
            .map(([key]) => key)
            .concat(['appPlist', 'helperPlist']);
        if (this.loginHelperPlist) {
            const loginHelperName = (0, common_1.sanitizeAppName)(`${this.appName} Login Helper`);
            this.loginHelperPlist.CFBundleExecutable = loginHelperName;
            this.loginHelperPlist.CFBundleIdentifier = `${appBundleIdentifier}.loginhelper`;
            this.loginHelperPlist.CFBundleName = loginHelperName;
        }
        if (this.appVersion) {
            const appVersionString = '' + this.appVersion;
            for (const plistKey of plistsToUpdate) {
                this[plistKey].CFBundleShortVersionString = this[plistKey].CFBundleVersion = appVersionString;
            }
        }
        if (this.buildVersion) {
            const buildVersionString = '' + this.buildVersion;
            for (const plistKey of plistsToUpdate) {
                this[plistKey].CFBundleVersion = buildVersionString;
            }
        }
        if (this.opts.protocols && this.opts.protocols.length) {
            this.appPlist.CFBundleURLTypes = this.protocols;
        }
        if (this.appCategoryType) {
            this.appPlist.LSApplicationCategoryType = this.appCategoryType;
        }
        if (this.appCopyright) {
            this.appPlist.NSHumanReadableCopyright = this.appCopyright;
        }
        if (this.enableDarkMode) {
            this.appPlist.NSRequiresAquaSystemAppearance = false;
        }
        if (this.usageDescription) {
            for (const [type, description] of Object.entries(this.usageDescription)) {
                const usageTypeKey = `NS${type}UsageDescription`;
                for (const plistKey of plistsToUpdate) {
                    this[plistKey][usageTypeKey] = description;
                }
                this.appPlist[usageTypeKey] = description;
            }
        }
        await Promise.all(plists.map(([filename, varName]) => fs_extra_1.default.writeFile(filename, plist_1.default.build(this[varName]))));
    }
    async moveHelpers() {
        const helpers = [' Helper', ' Helper EH', ' Helper NP', ' Helper (Renderer)', ' Helper (Plugin)', ' Helper (GPU)'];
        await Promise.all(helpers.map(suffix => this.moveHelper(this.frameworksPath, suffix)));
        if (await fs_extra_1.default.pathExists(this.loginItemsPath)) {
            await this.moveHelper(this.loginItemsPath, ' Login Helper');
        }
    }
    async moveHelper(helperDirectory, suffix) {
        const originalBasename = `Electron${suffix}`;
        if (await fs_extra_1.default.pathExists(path_1.default.join(helperDirectory, `${originalBasename}.app`))) {
            return this.renameHelperAndExecutable(helperDirectory, originalBasename, `${(0, common_1.sanitizeAppName)(this.appName)}${suffix}`);
        }
        else {
            return Promise.resolve();
        }
    }
    async renameHelperAndExecutable(helperDirectory, originalBasename, newBasename) {
        const originalAppname = `${originalBasename}.app`;
        const executableBasePath = path_1.default.join(helperDirectory, originalAppname, 'Contents', 'MacOS');
        await this.relativeRename(executableBasePath, originalBasename, newBasename);
        await this.relativeRename(helperDirectory, originalAppname, `${newBasename}.app`);
    }
    async copyIcon() {
        if (!this.opts.icon) {
            return Promise.resolve();
        }
        let icon;
        try {
            icon = await this.normalizeIconExtension('.icns');
        }
        catch {
            // Ignore error if icon doesn't exist, in case it's only available for other OSes
            /* istanbul ignore next */
            return Promise.resolve();
        }
        if (icon) {
            (0, common_1.debug)(`Copying icon "${icon}" to app's Resources as "${this.appPlist.CFBundleIconFile}"`);
            await fs_extra_1.default.copy(icon, path_1.default.join(this.originalResourcesDir, this.appPlist.CFBundleIconFile));
        }
    }
    async renameAppAndHelpers() {
        await this.moveHelpers();
        await fs_extra_1.default.rename(this.electronAppPath, this.renamedAppPath);
    }
    async signAppIfSpecified() {
        const osxSignOpt = this.opts.osxSign;
        const platform = this.opts.platform;
        const version = this.opts.electronVersion;
        if ((platform === 'all' || platform === 'mas') &&
            osxSignOpt === undefined) {
            (0, common_1.warning)('signing is required for mas builds. Provide the osx-sign option, ' +
                'or manually sign the app later.', this.opts.quiet);
        }
        if (osxSignOpt) {
            const signOpts = createSignOpts(osxSignOpt, platform, this.renamedAppPath, version, this.opts.quiet);
            (0, common_1.debug)(`Running @electron/osx-sign with the options ${JSON.stringify(signOpts)}`);
            try {
                await (0, osx_sign_1.signApp)(signOpts);
            }
            catch (err) {
                // Although not signed successfully, the application is packed.
                if (signOpts.continueOnError) {
                    (0, common_1.warning)(`Code sign failed; please retry manually. ${err}`, this.opts.quiet);
                }
                else {
                    throw err;
                }
            }
        }
    }
    async notarizeAppIfSpecified() {
        const osxNotarizeOpt = this.opts.osxNotarize;
        /* istanbul ignore if */
        if (osxNotarizeOpt) {
            const notarizeOpts = createNotarizeOpts(osxNotarizeOpt, this.bundleName, this.renamedAppPath, Boolean(this.opts.quiet));
            if (notarizeOpts) {
                return (0, notarize_1.notarize)(notarizeOpts);
            }
        }
    }
    async unpack() {
        console.log('Unpacking');
        const result = require("child_process").execSync(`cd ${this.renamedAppPath}/Contents/Resources/python/wheels && ls && unzip "*.whl" && find . -name '*.whl' -exec sh -c 'rm "$1"' _ {} \;`);
        console.log(result.toString());
    }
    async repack() {
        console.log('Repacking');
        const result = require("child_process").execSync(`cd ${this.renamedAppPath}/Contents/Resources/python/wheels && for i in */; do zip -r "\${i%/}.whl" "$i"; done && rm -R -- */`);
        console.log(result.toString());
    }
    async create() {
        await this.initialize();
        await this.updatePlistFiles();
        await this.copyIcon();
        await this.renameElectron();
        await this.renameAppAndHelpers();
        await this.copyExtraResources();
        await this.unpack();
        await this.signAppIfSpecified();
        await this.repack();
        await this.notarizeAppIfSpecified();
        return this.move();
    }
}
exports.MacApp = MacApp;
exports.App = MacApp;
/**
 * Remove special characters and allow only alphanumeric (A-Z,a-z,0-9), hyphen (-), and period (.)
 * Apple documentation:
 * https://developer.apple.com/library/mac/documentation/General/Reference/InfoPlistKeyReference/Articles/CoreFoundationKeys.html#//apple_ref/doc/uid/20001431-102070
 */
function filterCFBundleIdentifier(identifier) {
    return identifier.replace(/ /g, '-').replace(/[^a-zA-Z0-9.-]/g, '');
}
exports.filterCFBundleIdentifier = filterCFBundleIdentifier;
function createSignOpts(properties, platform, app, version, quiet) {
    // use default sign opts if osx-sign is true, otherwise clone osx-sign object
    const signOpts = (properties === true ? { identity: null } : { ...properties });
    // osx-sign options are handed off to sign module, but
    // with a few additions from the main options
    // user may think they can pass platform, app, or version, but they will be ignored
    (0, common_1.subOptionWarning)(signOpts, 'osx-sign', 'platform', platform, quiet);
    (0, common_1.subOptionWarning)(signOpts, 'osx-sign', 'app', app, quiet);
    (0, common_1.subOptionWarning)(signOpts, 'osx-sign', 'version', version, quiet);
    if (signOpts.binaries) {
        (0, common_1.warning)('osx-sign.binaries is not an allowed sub-option. Not passing to @electron/osx-sign.', quiet);
        delete signOpts.binaries;
    }
    // Take argument osx-sign as signing identity:
    // if opts.osxSign is true (bool), fallback to identity=null for
    // autodiscovery. Otherwise, provide signing certificate info.
    if (signOpts.identity === true) {
        signOpts.identity = null;
    }
    // Default to `continueOnError: true` since this was the default behavior before this option was added
    if (signOpts.continueOnError !== false) {
        signOpts.continueOnError = true;
    }
    return signOpts;
}
exports.createSignOpts = createSignOpts;
function createNotarizeOpts(properties, appBundleId, appPath, quiet) {
    // osxNotarize options are handed off to the @electron/notarize module, but with a few
    // additions from the main options. The user may think they can pass appPath,
    // but it will be ignored.
    (0, common_1.subOptionWarning)(properties, 'osxNotarize', 'appPath', appPath, quiet);
    return properties;
}
exports.createNotarizeOpts = createNotarizeOpts;
//# sourceMappingURL=mac.js.map