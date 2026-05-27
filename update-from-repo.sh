#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target="${COPYQ_COMMANDS_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/copyq/copyq-commands.ini}"

mkdir -p "$(dirname "$target")"

if [[ -f "$target" ]]; then
  backup="$target.backup-$(date +%Y%m%d-%H%M%S)"
  cp -a "$target" "$backup"
fi

perl -MJSON::PP=encode_json - "$repo_dir" "$target" <<'PERL'
use strict;
use warnings;
use JSON::PP qw(encode_json);

my ($repo_dir, $target) = @ARGV;

sub normalize_value {
  my ($value) = @_;
  return '' if !defined $value;
  $value =~ s/\r$//;
  if ($value =~ /^"(.*)"$/s) {
    $value = $1;
    $value =~ s/\\x([0-9A-Fa-f]{2})/chr(hex($1))/eg;
    $value =~ s/\\u([0-9A-Fa-f]{4})/chr(hex($1))/eg;
    $value =~ s/\\n/\n/g;
    $value =~ s/\\r/\r/g;
    $value =~ s/\\t/\t/g;
    $value =~ s/\\"/"/g;
    $value =~ s/\\\\/\\/g;
  }
  return $value;
}

sub is_command_open {
  my ($line) = @_;
  return index($line, 'Command="') == 0;
}

sub strip_unescaped_closing_quote {
  my ($line) = @_;
  return undef if !defined $line;
  return undef if $line eq '';
  return undef if substr($line, -1) ne '"';
  return undef if length($line) >= 2 && substr($line, -2, 1) eq '\\';
  return substr($line, 0, -1);
}

sub parse_repo_file {
  my ($path) = @_;
  open my $fh, '<:raw', $path or die "Failed to read $path: $!";
  my @lines = <$fh>;
  close $fh;

  chomp @lines;
  my $start = 0;
  $start++ while $start < @lines && $lines[$start] !~ /^\[(?:Command|Commands)\]$/;
  return undef if $start >= @lines || $lines[$start] eq '[Commands]';

  splice @lines, 0, $start + 1;

  my @props;
  for (my $i = 0; $i < @lines; $i++) {
    my $line = $lines[$i];
    next if $line eq '';

    if (is_command_open($line)) {
      my $rest = substr($line, length('Command="'));
      my @body;

      if (my $closed = strip_unescaped_closing_quote($rest)) {
        push @body, $closed if length $closed;
        my $command = join("\n", @body);
        push @props, ['Command', $command];
        next;
      }

      push @body, $rest if length $rest;
      $i++;
      while ($i < @lines) {
        my $body_line = $lines[$i];
        if (defined(my $closed = strip_unescaped_closing_quote($body_line))) {
          push @body, $closed if length $closed;
          last;
        }
        push @body, $body_line;
        $i++;
      }
      die "Unterminated Command block in $path" if $i >= @lines;
      my $command = join("\n", @body);
      push @props, ['Command', $command];
      next;
    }

    my ($key, $value) = split /=/, $line, 2;
    die "Malformed line in $path: $line" if !defined $value;
    push @props, [$key, $value];
  }

  my ($name_entry) = grep { $_->[0] eq 'Name' } @props;
  die "Missing Name in $path" if !$name_entry;

  return {
    path => $path,
    name => normalize_value($name_entry->[1]),
    command => (grep { $_->[0] eq 'Command' } @props)[0]->[1],
    props => \@props,
  };
}

sub find_repo_files {
  my ($dir) = @_;
  my @files = sort grep {
    -f $_
      && $_ !~ m{/(README\.md|update-from-repo\.sh|update-repo\.sh)$}
      && $_ !~ m{/\.}
      && $_ =~ /\.(?:ini|command\.ini)$/
  } glob("$dir/*");
  return @files;
}

sub read_runtime_file {
  my ($path) = @_;
  if (!-f $path) {
    return { order => [], sections => {} };
  }

  open my $fh, '<:raw', $path or die "Failed to read $path: $!";
  my @order;
  my %sections;

  while (my $line = <$fh>) {
    chomp $line;
    next if $line eq '' || $line eq '[Commands]';
    next if $line !~ /^(\d+)\\([^=]+)=(.*)$/s;

    my ($idx, $key, $value) = ($1, $2, $3);
    if (!exists $sections{$idx}) {
      push @order, $idx;
      $sections{$idx} = { idx => $idx, props => [], name => undef };
    }
    push @{ $sections{$idx}{props} }, [$key, $value];
    $sections{$idx}{name} = normalize_value($value) if $key eq 'Name';
  }

  close $fh;
  return { order => \@order, sections => \%sections };
}

sub write_runtime_file {
  my ($path, $runtime, $repo_by_name) = @_;
  my $tmp = "$path.tmp.$$";
  open my $out, '>:raw', $tmp or die "Failed to write $tmp: $!";
  print {$out} "[Commands]\n";

  my @order = @{ $runtime->{order} };
  my %sections = %{ $runtime->{sections} };
  my %used;
  my $next_idx = @order ? ($order[-1] + 1) : 1;

  for my $idx (@order) {
    my $section = $sections{$idx};
    my @props = @{ $section->{props} };
    if (defined $section->{name} && exists $repo_by_name->{ $section->{name} }) {
      my $repo = $repo_by_name->{ $section->{name} };
      my $command = encode_json($repo->{command});
      my $replaced = 0;
      for my $prop (@props) {
        if ($prop->[0] eq 'Command') {
          $prop->[1] = $command;
          $replaced = 1;
          last;
        }
      }
      push @props, ['Command', $command] if !$replaced;
      $used{ $section->{name} } = 1;
    }

    for my $prop (@props) {
      print {$out} $idx, '\\', $prop->[0], '=', $prop->[1], "\n";
    }
  }

  for my $name (sort keys %{$repo_by_name}) {
    next if $used{$name};
    my $repo = $repo_by_name->{$name};
    my @props;
    for my $prop (@{ $repo->{props} }) {
      my ($key, $value) = @$prop;
      $value = encode_json($value) if $key eq 'Command';
      push @props, [$key, $value];
    }

    for my $prop (@props) {
      print {$out} $next_idx, '\\', $prop->[0], '=', $prop->[1], "\n";
    }
    $next_idx++;
  }

  close $out;
  rename $tmp, $path or die "Failed to replace $path: $!";
}

my @repo_files = find_repo_files($repo_dir);
my %repo_by_name;
for my $path (@repo_files) {
  my $repo = parse_repo_file($path);
  next if !defined $repo;
  die "Duplicate command name in repo: $repo->{name}" if exists $repo_by_name{ $repo->{name} };
  $repo_by_name{ $repo->{name} } = $repo;
}

my $runtime = read_runtime_file($target);
write_runtime_file($target, $runtime, \%repo_by_name);
PERL
