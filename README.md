# Hubbitus CopyQ commands

[CopyQ](https://hluk.github.io/CopyQ/) is a great crossplatform clipboard manager with infinitive scripting capabilities.
There I would like to share some my commands and settings.

## How to load them

[See in official FAQ](https://copyq.readthedocs.io/en/latest/faq.html#faq-share-commands)

## Local sync

- `./update-from-repo.sh` updates `~/.config/copyq/copyq-commands.ini` from the command files in this repo.
- `./update-repo.sh` updates the repo command files from the current CopyQ commands file.
- Both scripts accept `COPYQ_COMMANDS_FILE=/path/to/copyq-commands.ini` if you want to point them at another config.

## Docs, links

- [Scripting reference](https://copyq.readthedocs.io/en/latest/scripting.html)
- [Writing commands](https://copyq.readthedocs.io/en/latest/writing-commands-and-adding-functionality.html)
- [Official command examples](https://copyq.readthedocs.io/en/latest/command-examples.html)
