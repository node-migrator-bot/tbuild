﻿/**
 * 基于KISSY 1.2+的模块打包工具
 * @author 橘子（紫英）<daxingplay@gmail.com>
 */
var fs = require('fs'),
    path = require('path'),
    fileUtil = require('./fileUtil'),
    iconv = require('iconv-lite');

function startWith(str, prefix){
    return str.lastIndexOf(prefix, 0) === 0;
}

function convertCharset(charset){
    charset = charset.toLowerCase();
    if(charset == '' || charset == 'gbk' || charset == 'gb2312'){
        charset = '';
    }
    return charset;
}

function addPkgNameToPath(pkgPath, pkgName){
    if(pkgName){
        var basename = path.basename(pkgPath).replace(/(\\|\/)$/, '');
        if(basename != pkgName){
            pkgPath = path.normalize(path.join(pkgPath, pkgName));
        }
    }
    return pkgPath;
}

var ModuleComplier = {
    _config: {
        exclude: [],
        suffix: '',
        charset: ''
    },
    _packages: {},
    _mappedRules: [],
    _moduleCache: {},
    _analyzedModules: [],
    _combinedModules: [],
    _clean: function(){
        this._moduleCache = {};
        this._analyzedModules = [];
        this._combinedModules = [];
    },
    _parseConfig: function(cfg){
        var self = this;
        if(cfg.packages){
            for(var i = 0; i < cfg.packages.length; i++){
                var pkg = cfg.packages[i];
                if(typeof pkg.charset === 'undefined'){
                    // if left blank, node will treat it as utf-8
                    pkg.charset = '';
                }
                pkg.path = path.resolve(addPkgNameToPath(pkg.path, pkg.name)) || __dirname;
                if(path.existsSync(pkg.path)){
                    self._packages[pkg.name] = pkg;
                }
            }
        }
        if(cfg.map){
            for(var i = 0; i < cfg.map.length; i++){
                var curMap = cfg.map[i];
                if(curMap && typeof curMap[0] !== 'undefined' && typeof curMap[1] !== 'undefined'){
                    self._mappedRules.push(curMap);
                }
            }
        }
        if(cfg.suffix){
            self._config.suffix = cfg.suffix;
        }
        self._config.debug = cfg.debug ? true : false;
        if(cfg.exclude){
            if(typeof cfg.exclude === 'string'){
                self._config.exclude.push(cfg.exclude);
            }else{
                self._config.exclude = self._config.exclude.concat(cfg.exclude);
            }
        }
        self._config.charset = '';
    },
    _removeComments: function(str){
        var totallen = str.length,
            token;

        // remove single line comments
        var startIndex = 0;
        var endIndex = 0;
        var comments = [];
        while ((startIndex = str.indexOf("//", startIndex)) >= 0) {
            endIndex = str.indexOf("\n", startIndex + 2);
            if (endIndex < 0) {
                endIndex = totallen;
            }
            token = str.slice(startIndex + 2, endIndex);
            comments.push(token);
            startIndex += 2;
        }
        for (var i=0,max=comments.length; i<max; i = i+1){
            str = str.replace("//" + comments[i] + "\n", "");
        }

        // remove multi line comments.
        startIndex = 0;
        endIndex = 0;
        comments = [];
        while ((startIndex = str.indexOf("/*", startIndex)) >= 0) {
            endIndex = str.indexOf("*/", startIndex + 2);
            if (endIndex < 0) {
                endIndex = totallen;
            }
            token = str.slice(startIndex + 2, endIndex);
            comments.push(token);
            startIndex += 2;
        }
        for (i=0,max=comments.length; i<max; i = i+1){
            str = str.replace("/*" + comments[i] + "*/", "");
        }

        // remove white spaces
        str = str.replace(/\s+/g, " ");

        return str;
    },
    _analyzeRequires: function(filePath){
        var self = this;
        if(self._analyzedModules.indexOf(filePath) > 0){
            self._config.debug && console.log('file :' + filePath + ' already analyzed.');
        }else if(path.existsSync(filePath)){
            var fileContent = fs.readFileSync(filePath).toString();
            // remove comments
            fileContent = self._removeComments(fileContent);

            var requires = fileContent.match(/\{[\s\w:'",]*requires\s*:\s*(\[?[^;\}]*\]?)\}\s*\)/g);
            if(requires != null){
                for(var i = 0; i < requires.length; i++){
                    var requiredModules = eval('(' + requires[i]).requires;
                    for(var j = 0; j < requiredModules.length; j++){
                        var requirePath = requiredModules[j],
                            module;
                        module = self._addModule(requirePath, path.dirname(filePath));
                        if(module !== null && module.path){
                            self._analyzeRequires(module.path);
                        }
                    }
                }
            }else{
                self._config.debug && console.log('INFO: module ' + filePath + ' has no depends.');
            }
            self._analyzedModules.push(filePath);
        }else{
            console.log('WARING: file %s not found.', filePath);
        }
    },
    _resolveModuleName: function(modulePath, pkg){
        var relativePkgPath = path.relative(pkg.path, modulePath).replace(/\\/g, '/'),
            moduleName = relativePkgPath.replace(/^\.\//, '');
        if(!startWith(relativePkgPath, pkg.name)){
            moduleName = pkg.name + '/' + moduleName;
        }
        return moduleName.replace(/\.js$/i, '');
    },
    _addModule: function(requirePath, curDir){
        var self = this,
            module = {};
        if(requirePath.match(/\.js$/i)){
            if(typeof curDir === 'undefined' || path.existsSync(requirePath)){
                self._config.debug && console.log('core module ' + requirePath);
                module.path = requirePath;
            }
        }else{
            requirePath += '.js';
        }
        if(requirePath.match(/^\.{1,2}/) && curDir){
            module.path = path.resolve(curDir, requirePath);
        }else{
            if(requirePath.indexOf('/') === 0){
                requirePath = requirePath.substring(1);
            }
        }
        var packageName,
            packagePath = '';
        for(var pkgName in self._packages){
            if(self._packages.hasOwnProperty(pkgName)){
                var pkg = self._packages[pkgName];
                if(startWith(requirePath, pkg.name + '/')){
                    module.path = path.resolve(pkg.path, requirePath.replace(pkg.name + '/', ''));
                    if(path.existsSync(module.path)){
                        packageName = pkg.name;
                        module.name = requirePath;
                        break;
                    }
                }
                if(module.path){
                    var curRelativePath = path.relative(pkg.path, module.path);
                    if(packagePath == '' || packagePath.length > curRelativePath.length){
                        packagePath = curRelativePath;
                        packageName = pkg.name;
                    }
                }else{
                    var curPath = path.normalize(path.join(pkg.path, requirePath));
                    if(path.existsSync(curPath)){
                        module.path = curPath;
                        packageName = pkg.name;
                        break;
                    }
                }
            }
        }
        if(module.path){
            module.package = self._packages[packageName];
            module.name = (typeof module.name === 'undefined' ? self._resolveModuleName(module.path, module.package) : module.name).replace(/\.js\s*$/i, '');
            module.name = self._mapModuleName(module.name);
            module.charset = module.package.charset;
            self._moduleCache[module.name] = module;
            self._combinedModules.push(module.name);
            return module;
        }else{
            self._config.debug && console.log('module %s cannot be found.', requirePath);
        }
        return null;
    },
    _mapModuleName: function(moduleName){
        var self = this;
        if(self._mappedRules.length > 0){
            for(var i = 0; i < self._mappedRules.length; i++){
                var rule = self._mappedRules[i];
                if(moduleName.match(rule[0])){
                    return moduleName.replace(rule[0], rule[1]);
                }
            }
        }
        return moduleName;
    },
    _combo: function(outputPath){
        var self = this,
            combinedComment = [
                '/*',
                'combined files : ',
                '',
                self._combinedModules.join('\r\n'),
                '',
                '*/',
                ''
            ].join('\r\n');

        var combineFile = self._config.suffix ? outputPath.replace(/\.js$/i, self._config.suffix + '.js') : outputPath;

        //prepare output dir
        fileUtil.mkdirsSync(path.dirname(combineFile));

        var fd = fs.openSync(combineFile, 'w');
        fs.writeSync(fd, combinedComment, 0, convertCharset(self._config.charset));
        fs.closeSync(fd);

        fd = fs.openSync(combineFile, 'a');

        for (var moduleName in self._moduleCache) {
            if(self._moduleCache.hasOwnProperty(moduleName)){
                var module = self._moduleCache[moduleName],
                    moduleContent = iconv.decode(fs.readFileSync(module.path), module.charset);

                //add module path
                var start = moduleContent.indexOf('KISSY.add(');
                if(start == -1) {
                    start = moduleContent.indexOf('.add(');
                    if(start != -1) {
                        start = start + 5;
                    }
                } else {
                    start = start + 10;
                }

                var end = moduleContent.indexOf('function', start);

                //find it
                if(start > -1 && end > start) {
                    //KISSY.add(/*xxx*/function(xxx))
                    var oldModuleName = moduleContent.substring(start, end),
                        moduleNameRegResult = oldModuleName.match(/^\/\*(.*)\*\/$/);
                    if(moduleNameRegResult != null){
                        moduleContent = moduleContent.replace(oldModuleName, moduleNameRegResult[1]);
                    }
                } else if(start > -1 && end == start) {
                    //KISSY.add(function(xxx))
                    moduleContent = [moduleContent.slice(0, start), '\'' + module.name + '\',', moduleContent.slice(end)].join('');
                }

                var buffer = iconv.encode(moduleContent, self._config.charset);
                fs.writeSync(fd, buffer, 0, buffer.length);
            }
        }

        fs.closeSync(fd);

    },
    build: function(inputPath, outputPath){
        var self = this;
        self._analyzeRequires(inputPath);
        var coreModule = self._addModule(inputPath);
        self._config.charset = coreModule.charset;
        // combo file.
        self._combo(outputPath);
        console.info('%s ===> %s', inputPath, outputPath);
        // clean.
        self._clean();
    },
    isExcluded: function(file){
        var self = this;
        for(var i = 0; i < self._config.exclude.length; i++){
            if(file.match(self._config.exclude[i])){
                return true;
            }
        }
        return false;
    }
};

module.exports = {
    config: function(cfg){
        ModuleComplier._parseConfig(cfg);
    },
    build: function(inputPath, outputPath){
        var target = path.resolve(inputPath);
        if(fs.statSync(target).isDirectory()) {
            var targets = fs.readdirSync(target);
            for (var i in targets) {
                var inputFile = path.resolve(target, targets[i]),
                    outputFile = path.join(outputPath, targets[i]);
                if(path.extname(inputFile)==='.js' && !ModuleComplier.isExcluded(inputFile)) {
                    ModuleComplier.build(inputFile, outputFile);
                }
            }
        } else {
            ModuleComplier.build(target, outputPath);
        }
    }
};