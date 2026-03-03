const { createRunOncePlugin, withAndroidManifest, withAppBuildGradle, withGradleProperties, withProjectBuildGradle } = require('expo/config-plugins');

const CHAQUOPY_VERSION = '15.0.1';
const YT_DLP_VERSION = '2026.2.4';
const CURL_CFFI_VERSION = '0.14.0';
const IMPERSONATION_WHEELS_DIR = 'modules/local-downloader/android/chaquopy-wheels';
const DOWNLOAD_SERVICE_NAME = 'expo.modules.localdownloader.DownloadForegroundService';
const DOWNLOAD_RECEIVER_NAME = 'expo.modules.localdownloader.DownloadActionReceiver';
const QUICK_CAPTURE_ACTIVITY_NAME = 'expo.modules.localdownloader.QuickDownloadCaptureActivity';

const TAGS = {
  buildscriptRepo: {
    begin: '// @generated begin local-downloader-chaquopy-buildscript-repo',
    end: '// @generated end local-downloader-chaquopy-buildscript-repo',
  },
  allprojectsRepo: {
    begin: '// @generated begin local-downloader-chaquopy-allprojects-repo',
    end: '// @generated end local-downloader-chaquopy-allprojects-repo',
  },
  buildscriptClasspath: {
    begin: '// @generated begin local-downloader-chaquopy-buildscript-classpath',
    end: '// @generated end local-downloader-chaquopy-buildscript-classpath',
  },
  pythonConfig: {
    begin: '// @generated begin local-downloader-python-config',
    end: '// @generated end local-downloader-python-config',
  },
  impersonationPip: {
    begin: '// @generated begin local-downloader-impersonation-pip',
    end: '// @generated end local-downloader-impersonation-pip',
  },
  sourceSetConfig: {
    begin: '// @generated begin local-downloader-sourceset-config',
    end: '// @generated end local-downloader-sourceset-config',
  },
  abiFilterConfig: {
    begin: '// @generated begin local-downloader-abi-filter-config',
    end: '// @generated end local-downloader-abi-filter-config',
  },
};

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripTaggedBlock(contents, tag) {
  const pattern = new RegExp(`\\n?${escapeRegex(tag.begin)}[\\s\\S]*?${escapeRegex(tag.end)}\\n?`, 'g');
  return contents.replace(pattern, '\n');
}

function upsertTaggedInSection(contents, sectionRegex, block, tag, sectionName) {
  const cleaned = stripTaggedBlock(contents, tag);
  let replaced = false;
  const next = cleaned.replace(sectionRegex, (_match, sectionStart, sectionBody, sectionEnd) => {
    replaced = true;
    const trimmedBody = sectionBody.replace(/\s+$/, '');
    return `${sectionStart}${trimmedBody}\n\n${block}\n${sectionEnd}`;
  });

  if (!replaced) {
    throw new Error(`[local-downloader plugin] Could not find ${sectionName} in Gradle file`);
  }

  return next;
}

function ensureChaquopyApplyPlugin(contents) {
  if (
    contents.includes('apply plugin: "com.chaquo.python"') ||
    contents.includes("apply plugin: 'com.chaquo.python'") ||
    contents.includes('id("com.chaquo.python")') ||
    contents.includes("id 'com.chaquo.python'")
  ) {
    return contents;
  }

  let replaced = contents.replace(
    /apply plugin:\s*["']com\.android\.application["']/,
    (match) => `${match}\napply plugin: "com.chaquo.python"`
  );

  if (replaced !== contents) {
    return replaced;
  }

  replaced = contents.replace(
    /(plugins\s*\{[\s\S]*?id\s*\(?["']com\.android\.application["']\)?[\s\S]*?)(\n\})/m,
    (_match, beforeEnd, closing) => `${beforeEnd}\n    id("com.chaquo.python")${closing}`
  );

  if (replaced === contents) {
    throw new Error('[local-downloader plugin] Could not find a supported android application plugin anchor in app/build.gradle');
  }

  return replaced;
}

function cleanLegacyInjectedBlocks(contents) {
  let next = contents;

  next = next.replace(/\npython\s*\{[\s\S]*?yt-dlp==\d{4}\.\d{1,2}\.\d{1,2}[\s\S]*?\n\}\n?/g, '\n');
  next = next.replace(/\nchaquopy\s*\{[\s\S]*?yt-dlp==\d{4}\.\d{1,2}\.\d{1,2}[\s\S]*?\n\}\n?/g, '\n');
  next = next.replace(/\nandroid\s*\{\s*\n\s*sourceSets\s*\{[\s\S]*?python\.srcDir\s+\(?["']\.\.\/\.\.\/modules\/local-downloader\/android\/src\/main\/python["']\)?[\s\S]*?\n\s*\}\s*\n\}\n?/g, '\n');

  return next;
}

function addProjectGradleChanges(contents) {
  let next = contents;

  const buildscriptRepoBlock = `${TAGS.buildscriptRepo.begin}\n        maven { url "https://chaquo.com/maven" }\n${TAGS.buildscriptRepo.end}`;
  const allprojectsRepoBlock = `${TAGS.allprojectsRepo.begin}\n    maven { url "https://chaquo.com/maven" }\n${TAGS.allprojectsRepo.end}`;
  const classpathBlock = `${TAGS.buildscriptClasspath.begin}\n    classpath("com.chaquo.python:gradle:${CHAQUOPY_VERSION}")\n${TAGS.buildscriptClasspath.end}`;

  next = upsertTaggedInSection(
    next,
    /(buildscript\s*\{[\s\S]*?repositories\s*\{)([\s\S]*?)(\n\s*\})/m,
    buildscriptRepoBlock,
    TAGS.buildscriptRepo,
    'buildscript.repositories'
  );

  next = upsertTaggedInSection(
    next,
    /(allprojects\s*\{[\s\S]*?repositories\s*\{)([\s\S]*?)(\n\s*\})/m,
    allprojectsRepoBlock,
    TAGS.allprojectsRepo,
    'allprojects.repositories'
  );

  next = upsertTaggedInSection(
    next,
    /(buildscript\s*\{[\s\S]*?dependencies\s*\{)([\s\S]*?)(\n\s*\})/m,
    classpathBlock,
    TAGS.buildscriptClasspath,
    'buildscript.dependencies'
  );

  return next;
}

function addAppGradleChanges(contents) {
  let next = cleanLegacyInjectedBlocks(contents);

  next = ensureChaquopyApplyPlugin(next);

  const wheelsDirNormalized = IMPERSONATION_WHEELS_DIR.replace(/\\/g, '/');
  const impersonationPipBlock = `${TAGS.impersonationPip.begin}\n            def impersonationWheelsDir = file("../../${wheelsDirNormalized}")\n            if (impersonationWheelsDir.exists()) {\n                options("--find-links", impersonationWheelsDir.absolutePath)\n                install("curl-cffi==${CURL_CFFI_VERSION}")\n            } else {\n                println("[local-downloader] Impersonation wheels not found at ${wheelsDirNormalized}; continuing without curl-cffi")\n            }\n${TAGS.impersonationPip.end}`;
  const pythonBlock = `${TAGS.pythonConfig.begin}\nchaquopy {\n    defaultConfig {\n        version = "3.11"\n        pip {\n            install("yt-dlp==${YT_DLP_VERSION}")\n            install("tenacity==9.0.0")\n${impersonationPipBlock}\n        }\n    }\n    sourceSets {\n        getByName("main") {\n            srcDir("../../modules/local-downloader/android/src/main/python")\n        }\n    }\n}\n${TAGS.pythonConfig.end}`;

  const sourceSetBlock = `${TAGS.sourceSetConfig.begin}\nandroid {\n    sourceSets {\n        main {\n            assets.srcDirs += ["../../modules/local-downloader/android/src/main/assets"]\n        }\n    }\n}\n${TAGS.sourceSetConfig.end}`;
  const abiFilterBlock = `${TAGS.abiFilterConfig.begin}\nandroid {\n    defaultConfig {\n        ndk {\n            abiFilters "arm64-v8a"\n        }\n    }\n}\n${TAGS.abiFilterConfig.end}`;

  next = stripTaggedBlock(next, TAGS.pythonConfig);
  next = stripTaggedBlock(next, TAGS.sourceSetConfig);
  next = stripTaggedBlock(next, TAGS.abiFilterConfig);

  next = `${next.trimEnd()}\n\n${pythonBlock}\n\n${sourceSetBlock}\n\n${abiFilterBlock}\n`;

  return next;
}

function ensureManifestPermission(manifest, name) {
  const existing = manifest['uses-permission'] || [];
  if (!existing.some((item) => item.$?.['android:name'] === name)) {
    existing.push({ $: { 'android:name': name } });
  }
  manifest['uses-permission'] = existing;
}

function ensureApplicationEntry(mainApplication, key, androidName, extra = {}) {
  const existing = mainApplication[key] || [];
  const found = existing.find((item) => item.$?.['android:name'] === androidName);
  if (found) {
    found.$ = { ...(found.$ || {}), ...extra, 'android:name': androidName };
  } else {
    existing.push({
      $: {
        'android:name': androidName,
        ...extra,
      },
    });
  }
  mainApplication[key] = existing;
}

function addAndroidManifestChanges(config) {
  return withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;
    ensureManifestPermission(manifest, 'android.permission.FOREGROUND_SERVICE');
    ensureManifestPermission(manifest, 'android.permission.FOREGROUND_SERVICE_DATA_SYNC');
    ensureManifestPermission(manifest, 'android.permission.POST_NOTIFICATIONS');

    const mainApplication = manifest.application?.[0];
    if (!mainApplication) {
      throw new Error('[local-downloader plugin] Could not find Android application block in AndroidManifest.xml');
    }

    ensureApplicationEntry(mainApplication, 'service', DOWNLOAD_SERVICE_NAME, {
      'android:exported': 'false',
      'android:foregroundServiceType': 'dataSync',
      'android:stopWithTask': 'false',
    });

    ensureApplicationEntry(mainApplication, 'receiver', DOWNLOAD_RECEIVER_NAME, {
      'android:exported': 'false',
    });

    ensureApplicationEntry(mainApplication, 'activity', QUICK_CAPTURE_ACTIVITY_NAME, {
      'android:exported': 'false',
      'android:excludeFromRecents': 'true',
      'android:noHistory': 'true',
      'android:launchMode': 'singleTask',
      'android:taskAffinity': '',
      'android:theme': '@android:style/Theme.DeviceDefault.Dialog.NoActionBar',
    });

    return modConfig;
  });
}

const withLocalDownloader = (config) => {
  config = addAndroidManifestChanges(config);

  config = withGradleProperties(config, (config) => {
    const upsertProperty = (key, value) => {
      const existing = config.modResults.find((item) => item.type === 'property' && item.key === key);
      if (existing) {
        existing.value = value;
      } else {
        config.modResults.push({
          type: 'property',
          key,
          value,
        });
      }
    };

    upsertProperty('expo.useLegacyPackaging', 'true');
    // Vendored impersonation wheel coverage is currently arm64-only.
    upsertProperty('reactNativeArchitectures', 'arm64-v8a');
    return config;
  });

  config = withProjectBuildGradle(config, (config) => {
    config.modResults.contents = addProjectGradleChanges(config.modResults.contents);
    return config;
  });

  config = withAppBuildGradle(config, (config) => {
    config.modResults.contents = addAppGradleChanges(config.modResults.contents);
    return config;
  });

  return config;
};

module.exports = createRunOncePlugin(withLocalDownloader, 'local-downloader', '1.0.0');
