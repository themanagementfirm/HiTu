const glob = require('glob');
const fs = require('fs-extra');
const path = require('path');
const jsdom = require('jsdom');
const chalk = require('chalk');
const SVGO = require('svgo');

const svgo = new SVGO({
  plugins: [
    {
      removeXMLNS: true,
    },
    {
      prefixIds: true,
    },
  ],
});

const englishMapping = require('./englishMapping');

const { JSDOM } = jsdom;
const { window } = new JSDOM();

const SOURCE_PATH = 'src';

var $ = require('jquery')(window);

function toModuleName(path) {
  return path.slice(`${SOURCE_PATH}/`.length).replace('.tsx', '');
}

function toEnglish(path) {
  let retPath = path;
  const names = Object.keys(englishMapping).sort((a, b) => b.length - a.length);
  names.forEach(name => {
    retPath = retPath.replace(name, englishMapping[name]);
  });

  if (retPath.replace(/[a-zA-Z\d_\/\\\.]+/g, '').trim().length) {
    throw new Error(`Still exist uncovered text ${retPath}`);
  }

  return retPath;
}

glob('svg/**/*.svg', {}, async function(er, files) {
  console.log(
    chalk.yellow('Find'),
    chalk.green(files.length),
    chalk.yellow('assets'),
  );

  fs.removeSync(SOURCE_PATH);
  fs.ensureDirSync(SOURCE_PATH);
  fs.copySync('template/interface.ts', path.join(SOURCE_PATH, 'interface.ts'));
  fs.copySync('template/util.ts', path.join(SOURCE_PATH, 'util.ts'));

  const tsxList = new Set();

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];

    // if (!file.includes('盆栽')) {
    //   continue;
    // }
    // ==================== Path name ====================
    let tsxPath = path.join(
      SOURCE_PATH,
      file
        .replace('.svg', '_tsx')
        .replace('svg/', '')
        .replace(/\d+\./g, '')
        .replace(/\//g, '_')
        .replace('_tsx', '.tsx'),
    );

    tsxPath = toEnglish(tsxPath);

    if (tsxList.has(tsxPath)) {
      throw new Error(`Name duplicated: ${file} - ${tsxPath}`);
    }
    tsxList.add(tsxPath);

    console.log('Convert:', file, '->', tsxPath);

    // =================== Module name ===================
    // const moduleName = toModuleName(tsxPath);

    let text = fs.readFileSync(file, 'utf8');
    const optimizeResult = await svgo.optimize(text, { path: tsxPath });
    const svgInfo = optimizeResult.info;
    text = optimizeResult.data;

    const dangerHTML = $(text).html();

    const fileContent = `
import * as React from 'react';
import { AssetComponent, AssetProps } from './interface';
import { replaceTheme } from './util';

const HTML = \`${dangerHTML}\`;

const Asset: React.RefForwardingComponent<SVGSVGElement, AssetProps> = ({ theme, ...props }, ref) => {
  return React.useMemo(() => {
    const __html = replaceTheme(HTML, theme);

    return (
      <svg
        ref={ref}
        viewBox="0 0 ${svgInfo.width} ${svgInfo.height}"
        width="${svgInfo.width}"
        height="${svgInfo.height}"
        {...props}
        dangerouslySetInnerHTML={{
          __html,
        }}
      />
    );
  }, [theme]);
};

Asset.displayName = '${tsxPath
      .replace(SOURCE_PATH, '')
      .replace(/\.tsx$/, '')
      .slice(1)}';

const RefAsset = React.forwardRef(Asset) as AssetComponent;
RefAsset.__RAW__ = HTML;
RefAsset.width = ${svgInfo.width};
RefAsset.height = ${svgInfo.height};

export default RefAsset;
    `.trim();
    fs.writeFileSync(tsxPath, fileContent, 'utf8');
  }

  // ==================== Entry Index ====================
  let indexText = "export { Theme, AssetProps } from './interface';\n\n";
  tsxList.forEach(path => {
    indexText += `export { default as ${toModuleName(
      path,
    )} } from '${path.replace(SOURCE_PATH, '.').replace('.tsx', '')}'\n`;
  });

  fs.writeFileSync(path.join(SOURCE_PATH, 'index.tsx'), indexText, 'utf8');
});
