const { createRunOncePlugin, withAppBuildGradle, withProjectBuildGradle } = require('expo/config-plugins');

const CHAQUOPY_VERSION = '15.0.1';

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
  sourceSetConfig: {
    begin: '// @generated begin local-downloader-sourceset-config',
    end: '// @generated end local-downloader-sourceset-config',
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
  if (contents.includes('apply plugin: "com.chaquo.python"')) {
    return contents;
  }

  const replaced = contents.replace(
    /apply plugin: "com\.android\.application"/,
    'apply plugin: "com.android.application"\napply plugin: "com.chaquo.python"'
  );

  if (replaced === contents) {
    throw new Error('[local-downloader plugin] Could not find android application plugin line in app/build.gradle');
  }

  return replaced;
}

function cleanLegacyInjectedBlocks(contents) {
  let next = contents;

  next = next.replace(/\npython\s*\{[\s\S]*?yt-dlp==2025\.01\.12[\s\S]*?\n\}\n?/g, '\n');
  next = next.replace(/\nandroid\s*\{\s*\n\s*sourceSets\s*\{[\s\S]*?python\.srcDir\s+"\.\.\/\.\.\/modules\/local-downloader\/android\/src\/main\/python"[\s\S]*?\n\s*\}\s*\n\}\n?/g, '\n');

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

  const pythonBlock = `${TAGS.pythonConfig.begin}\npython {\n    version "3.11"\n    pip {\n        install "yt-dlp==2025.01.12"\n        install "tenacity==9.0.0"\n    }\n}\n${TAGS.pythonConfig.end}`;

  const sourceSetBlock = `${TAGS.sourceSetConfig.begin}\nandroid {\n    sourceSets {\n        main {\n            python.srcDir "../../modules/local-downloader/android/src/main/python"\n            assets.srcDirs += ["../../modules/local-downloader/android/src/main/assets"]\n        }\n    }\n}\n${TAGS.sourceSetConfig.end}`;

  next = stripTaggedBlock(next, TAGS.pythonConfig);
  next = stripTaggedBlock(next, TAGS.sourceSetConfig);

  next = `${next.trimEnd()}\n\n${pythonBlock}\n\n${sourceSetBlock}\n`;

  return next;
}

const withLocalDownloader = (config) => {
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
