const { createRunOncePlugin, withAppBuildGradle, withProjectBuildGradle } = require('expo/config-plugins');

const CHAQUOPY_VERSION = '15.0.1';

function addProjectGradleChanges(contents) {
  let next = contents;

  if (!next.includes('https://chaquo.com/maven')) {
    next = next.replace(
      /repositories\s*\{([\s\S]*?)\}/,
      (match, inner) => `repositories {${inner}\n        maven { url "https://chaquo.com/maven" }\n    }`
    );
  }

  if (!next.includes('com.chaquo.python:gradle')) {
    next = next.replace(
      /dependencies\s*\{([\s\S]*?)\}/,
      (match, inner) => `dependencies {${inner}\n        classpath("com.chaquo.python:gradle:${CHAQUOPY_VERSION}")\n    }`
    );
  }

  return next;
}

function addAppGradleChanges(contents) {
  let next = contents;

  if (!next.includes('apply plugin: "com.chaquo.python"')) {
    next = next.replace(
      /apply plugin: "com\.android\.application"/,
      `apply plugin: "com.android.application"\napply plugin: "com.chaquo.python"`
    );
  }

  if (!next.includes('python {') || !next.includes('yt-dlp==2025.01.12')) {
    next += `

python {
    version "3.11"
    pip {
        install "yt-dlp==2025.01.12"
        install "tenacity==9.0.0"
    }
}

android {
    sourceSets {
        main {
            python.srcDir "../../modules/local-downloader/android/src/main/python"
            assets.srcDirs += ["../../modules/local-downloader/android/src/main/assets"]
        }
    }
}
`;
  }

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
