import typescript from '@rollup/plugin-typescript';
import generatePackageJson from 'rollup-plugin-generate-package-json'
import {namespaceName} from "./rollup.globals.mjs";

// rollup.config.js
export default {
    input: 'src/index.ts',
    output: {
        dir: 'dist/es',
        name: namespaceName,
        format: 'es'
    },
    plugins: [
        typescript({
            tsconfig: "tsconfig.json"
        }),
        generatePackageJson({
            outputFolder: "dist",
            baseContents: (pkg) => {
                pkg.main = "es/index.js";
                pkg.scripts = undefined;
                return pkg;
            }
        })
    ]
};
