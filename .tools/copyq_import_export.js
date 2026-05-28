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

function leadingWhitespace(line) {
  if (line == null)
    return '';
  var match = line.match(/^[ \t]*/);
  return match ? match[0] : '';
}

function shiftIndent(line, delta) {
  if (delta > 0) {
    var count = 0;
    while (count < delta && count < line.length && line.charAt(count) == ' ')
      ++count;
    return line.slice(count);
  }

  if (delta < 0) {
    var pad = '';
    for (var i = 0; i < -delta; ++i)
      pad += ' ';
    return pad + line;
  }

  return line;
}

function isBlockOpen(line) {
  return /^(?:[0-9]+\\)?(?:Command|MatchCommand)="$/.test(line.trim());
}

function isBlockClose(line) {
  return line.trim() == '"';
}

function isBlankLine(line) {
  if (line == null)
    return true;
  return line.trim() == '';
}

function countLeadingBlankLines(lines) {
  var count = 0;
  while (count < lines.length && isBlankLine(lines[count]))
    ++count;
  return count;
}

function countTrailingBlankLines(lines) {
  var count = 0;
  while (count < lines.length && isBlankLine(lines[lines.length - 1 - count]))
    ++count;
  return count;
}

function trimOuterBlankLines(lines) {
  var start = 0;
  var end = lines.length;

  while (start < end && isBlankLine(lines[start]))
    ++start;
  while (end > start && isBlankLine(lines[end - 1]))
    --end;

  return lines.slice(start, end);
}

function makeBlankLines(count) {
  var lines = [];
  for (var i = 0; i < count; ++i)
    lines.push('');
  return lines;
}

function normalizeBodyForComparison(lines) {
  return trimOuterBlankLines(lines).map(function(line) {
    return line.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
  }).join('\n');
}

function normalizeTextForComparison(text) {
  var lines = trimOuterBlankLines(text.split('\n'));
  var out = [];
  var previousBlank = false;

  for (var i = 0; i < lines.length; ++i) {
    var line = lines[i].replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
    var blank = line == '';

    if (blank) {
      if (previousBlank)
        continue;
      previousBlank = true;
      out.push('');
      continue;
    }

    previousBlank = false;
    out.push(line);
  }

  return out.join('\n');
}

function collectBlocks(lines) {
  var blocks = [];

  for (var i = 0; i < lines.length; ++i) {
    if (!isBlockOpen(lines[i]))
      continue;

    var openIndex = i;
    var bodyStart = i + 1;
    while (i + 1 < lines.length && !isBlockClose(lines[i + 1]))
      ++i;

    blocks.push({
      openIndex: openIndex,
      bodyStart: bodyStart,
      closeIndex: i + 1,
    });
  }

  return blocks;
}

function adjustCommandBlocks(originalText, exportedText) {
  var originalNormalizedText = normalizeTextForComparison(originalText);
  var exportedNormalizedText = normalizeTextForComparison(exportedText);

  if (originalNormalizedText == exportedNormalizedText)
    return originalText;

  var originalLines = originalText.split('\n');
  var exportedLines = exportedText.split('\n');
  var originalBlocks = collectBlocks(originalLines);
  var exportedBlocks = collectBlocks(exportedLines);

  if (originalBlocks.length != exportedBlocks.length)
    return exportedText;

  var out = [];
  var cursor = 0;

  for (var b = 0; b < exportedBlocks.length; ++b) {
    var originalBlock = originalBlocks[b];
    var exportedBlock = exportedBlocks[b];
    var originalIndent = '';
    var exportedIndent = '';
    var originalQuoteIndent = leadingWhitespace(originalLines[originalBlock.closeIndex]);
    var exportedQuoteIndent = leadingWhitespace(exportedLines[exportedBlock.closeIndex]);
    var originalBody = originalLines.slice(originalBlock.bodyStart, originalBlock.closeIndex);
    var exportedBody = exportedLines.slice(exportedBlock.bodyStart, exportedBlock.closeIndex);
    var originalLeadingBlanks = countLeadingBlankLines(originalBody);
    var originalTrailingBlanks = countTrailingBlankLines(originalBody);
    var originalNormalizedBody = normalizeBodyForComparison(originalBody);
    var exportedNormalizedBody = normalizeBodyForComparison(exportedBody);
    var body = exportedBody;

    if (originalNormalizedBody == exportedNormalizedBody) {
      body = originalBody.slice(0);
    } else {
      for (var i = 0; i < originalBody.length; ++i) {
        if (originalBody[i] != '') {
          originalIndent = leadingWhitespace(originalBody[i]);
          break;
        }
      }

      for (var i = 0; i < exportedBody.length; ++i) {
        if (exportedBody[i] != '') {
          exportedIndent = leadingWhitespace(exportedBody[i]);
          break;
        }
      }

      var delta = exportedIndent.length - originalIndent.length;
      for (var i = 0; i < exportedBody.length; ++i)
        exportedBody[i] = shiftIndent(exportedBody[i], delta);

      body = trimOuterBlankLines(exportedBody);
      body = makeBlankLines(originalLeadingBlanks).concat(body).concat(makeBlankLines(originalTrailingBlanks));
    }

    while (cursor < exportedBlock.openIndex)
      out.push(exportedLines[cursor++]);

    out.push(exportedLines[exportedBlock.openIndex]);
    for (var i = 0; i < body.length; ++i)
      out.push(body[i]);
    out.push(shiftIndent(exportedLines[exportedBlock.closeIndex], exportedQuoteIndent.length - originalQuoteIndent.length));

    cursor = exportedBlock.closeIndex + 1;
  }

  while (cursor < exportedLines.length)
    out.push(exportedLines[cursor++]);

  return out.join('\n');
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

  for (var i = 0; i < files.length; i += 3) {
    var repoFile = files[i];
    var importFile = files[i + 1];
    var baselineFile = files[i + 2];
    var originalText = baselineFile ? readFile(baselineFile) : '';
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

    var text = updated.length == 1 ? exportSingleCommand(updated[0]) : exportCommands(updated);
    if (originalText)
      text = adjustCommandBlocks(originalText, text);

    writeFile(repoFile, text);
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
