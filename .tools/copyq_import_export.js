var mode = arguments[1];
var target = arguments[2];
var repoDir = arguments[3];
var files = arguments.slice(4);

function readFile(path) {
  var file = new File(path);
  if (!file.openReadOnly())
    throw Error('Failed to read ' + path + ': ' + file.errorString());
  var text = str(file.readAll());
  file.close();
  return text;
}

function writeFile(path, text) {
  var file = new File(path);
  if (file.exists())
    file.remove();
  if (!file.openWriteOnly())
    throw Error('Failed to open ' + path + ': ' + file.errorString());
  file.write(text);
  file.close();
}

function sanitizeFileName(name) {
  var base = name
    .replace(/['"]/g, '')
    .replace(/[^0-9A-Za-zА-Яа-яЁё]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

  return base ? base : 'command';
}

function makeUniquePath(dir, baseName) {
  var suffix = '.command.ini';
  var path = dir + '/' + baseName + suffix;

  for (var i = 2; new File(path).exists(); ++i)
    path = dir + '/' + baseName + '-' + i + suffix;

  return path;
}

function exportSingleCommand(command) {
  var text = exportCommands([command]);
  var lines = text.split('\n');
  var out = ['[Command]'];

  for (var i = 0; i < lines.length; ++i) {
    var line = lines[i];
    if (line == '' || line == '[Command]' || line == '[Commands]' || line.indexOf('size=') == 0)
      continue;

    var match = line.match(/^[0-9]+\\(.*)$/);
    out.push(match ? match[1] : line);
  }

  return out.join('\n') + '\n';
}

function updateRepo() {
  var current = importCommands(readFile(target));
  var currentByName = {};
  var usedNames = {};
  var updatedFiles = 0;

  for (var i = 0; i < current.length; ++i) {
    var cmd = current[i];
    if (cmd && cmd.name)
      currentByName[cmd.name] = cmd;
  }

  for (var i = 0; i < files.length; i += 2) {
    var repoFile = files[i];
    var importFile = files[i + 1];
    var imported = importCommands(readFile(importFile));
    var updated = [];

    for (var j = 0; j < imported.length; ++j) {
      var cmd = imported[j];
      if (currentByName[cmd.name]) {
        updated.push(currentByName[cmd.name]);
        usedNames[cmd.name] = true;
      }
    }

    if (updated.length == 0) {
      if (new File(repoFile).exists())
        new File(repoFile).remove();
      continue;
    }

    writeFile(repoFile, updated.length == 1 ? exportSingleCommand(updated[0]) : exportCommands(updated));
    ++updatedFiles;
  }

  for (var i = 0; i < current.length; ++i) {
    var cmd = current[i];
    if (!cmd || !cmd.name || usedNames[cmd.name])
      continue;

    writeFile(
      makeUniquePath(repoDir, sanitizeFileName(cmd.name)),
      exportSingleCommand(cmd)
    );
    ++updatedFiles;
  }

  return updatedFiles;
}

function updateFromRepo() {
  var commands = [];

  for (var i = 0; i < files.length; ++i)
    commands = commands.concat(importCommands(readFile(files[i])));

  var text = exportCommands(commands);
  writeFile(target, text);
  return text.length;
}

var result;
if (mode == 'update-repo') {
  result = updateRepo();
} else if (mode == 'update-from-repo') {
  result = updateFromRepo();
} else {
  throw Error('Unknown mode: ' + mode);
}

result;
