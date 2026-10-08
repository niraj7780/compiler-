'use strict';

const toolchains = require('./toolchains');

/**
 * Language registry for the online compiler.
 * Every entry describes how to build/run the code inside the sandbox image,
 * what Monaco language id to use, and which starter program to show.
 *
 * `build` and `run` are POSIX shell snippets executed with the working
 * directory set to /work inside the container (or the temp dir locally).
 */
const LANGUAGES = [
  {
    id: 'python',
    name: 'Python',
    monaco: 'python',
    ext: 'py',
    image: 'python:3.12-slim',
    versionCmd: ['python3', '--version'],
    build: '',
    run: 'python3 main.py',
    starter: `# Python
import sys

name = sys.stdin.readline().strip() or "world"
print(f"Hello, {name}!")
`,
    input: 'DevCode',
  },
  {
    id: 'javascript',
    name: 'JavaScript',
    monaco: 'javascript',
    ext: 'js',
    image: 'node:22-slim',
    versionCmd: ['node', '--version'],
    build: '',
    run: 'node main.js',
    starter: `// JavaScript (Node.js)
const fs = require("fs");
const line = fs.readFileSync(0, "utf8").split("\\n")[0] || "";
const name = line.trim() || "world";

console.log(\`Hello, \${name}!\`);
`,
    input: 'DevCode',
  },
  {
    id: 'typescript',
    name: 'TypeScript',
    monaco: 'typescript',
    ext: 'ts',
    image: 'devcode/ts:1',
    versionCmd: ['tsc', '--version'],
    build:
      'tsc --strict --target es2020 --lib es2020 --module commonjs main.ts globals.d.ts',
    run: 'node main.js',
    extraFiles: {
      'globals.d.ts':
        'declare const require: (id: string) => any;\n' +
        'declare const process: any;\n' +
        'declare const console: {\n' +
        '  log(...args: any[]): void;\n' +
        '  error(...args: any[]): void;\n' +
        '  warn(...args: any[]): void;\n' +
        '  info(...args: any[]): void;\n' +
        '};\n',
    },
    starter: `// TypeScript
const fs = require("fs");
const line: string = fs.readFileSync(0, "utf8").split("\\n")[0] || "";
const name: string = line.trim() || "world";

const greet = (who: string): string => \`Hello, \${who}!\`;

console.log(greet(name));
`,
    input: 'DevCode',
  },
  {
    id: 'java',
    name: 'Java',
    monaco: 'java',
    ext: 'java',
    image: 'eclipse-temurin:21-jdk-jammy',
    versionCmd: ['java', '-version'],
    build: 'javac -encoding UTF-8 Main.java',
    run: 'java -XX:+UseSerialGC -Xmx192m -cp . Main',
    starter: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String name = sc.hasNextLine() ? sc.nextLine().trim() : "";
        if (name.isEmpty()) name = "world";
        System.out.println("Hello, " + name + "!");
    }
}
`,
    input: 'DevCode',
    mainFile: 'Main.java',
  },
  {
    id: 'c',
    name: 'C',
    monaco: 'c',
    ext: 'c',
    image: 'gcc:13.2',
    versionCmd: ['gcc', '--version'],
    build: 'gcc -O2 -std=c17 -Wall -o prog main.c',
    run: './prog',
    starter: `#include <stdio.h>

int main(void) {
    char name[64];
    if (fgets(name, sizeof name, stdin)) {
        /* strip trailing newline */
        name[strcspn(name, "\\n")] = '\\0';
    } else {
        name[0] = '\\0';
    }
    printf("Hello, %s!\\n", name[0] ? name : "world");
    return 0;
}
`,
    input: 'DevCode',
  },
  {
    id: 'cpp',
    name: 'C++',
    monaco: 'cpp',
    ext: 'cpp',
    image: 'gcc:13.2',
    versionCmd: ['g++', '--version'],
    build: 'g++ -O2 -std=c++17 -Wall -o prog main.cpp',
    run: './prog',
    starter: `#include <iostream>
#include <string>

int main() {
    std::string name;
    if (!std::getline(std::cin, name) || name.empty()) name = "world";
    std::cout << "Hello, " << name << "!\\n";
    return 0;
}
`,
    input: 'DevCode',
  },
  {
    id: 'go',
    name: 'Go',
    monaco: 'go',
    ext: 'go',
    image: 'golang:1.23-alpine',
    versionCmd: ['go', 'version'],
    build: 'go build -o prog main.go',
    run: './prog',
    sharedCache: 'gocache',
    starter: `package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

func main() {
	line, _ := bufio.NewReader(os.Stdin).ReadString('\\n')
	name := strings.TrimSpace(line)
	if name == "" {
		name = "world"
	}
	fmt.Printf("Hello, %s!\\n", name)
}
`,
    input: 'DevCode',
    env: { GO111MODULE: 'off', GOPATH: '/tmp/gopath' },
  },
  {
    id: 'ruby',
    name: 'Ruby',
    monaco: 'ruby',
    ext: 'rb',
    image: 'ruby:3.3-slim',
    versionCmd: ['ruby', '--version'],
    build: '',
    run: 'ruby main.rb',
    starter: `# Ruby
name = gets&.strip
name = "world" if name.nil? || name.empty?
puts "Hello, #{name}!"
`,
    input: 'DevCode',
  },
  {
    id: 'php',
    name: 'PHP',
    monaco: 'php',
    ext: 'php',
    image: 'php:8.3-cli',
    versionCmd: ['php', '--version'],
    build: '',
    run: 'php main.php',
    starter: `<?php
// PHP
$name = trim((string)@fgets(STDIN));
if ($name === "") { $name = "world"; }
echo "Hello, {$name}!\\n";
`,
    input: 'DevCode',
  },
  {
    id: 'perl',
    name: 'Perl',
    monaco: 'perl',
    ext: 'pl',
    image: 'devcode/perl:1',
    versionCmd: ['perl', '-v'],
    build: '',
    run: 'perl main.pl',
    starter: `# Perl
my $name = <STDIN> // "";
chomp $name;
$name = "world" unless $name =~ /\\S/;
print "Hello, $name!\\n";
`,
    input: 'DevCode',
  },
  {
    id: 'bash',
    name: 'Bash',
    monaco: 'shell',
    ext: 'sh',
    image: 'debian:trixie-slim',
    versionCmd: ['bash', '--version'],
    build: '',
    run: 'bash main.sh',
    starter: `#!/usr/bin/env bash
# Bash
read -r name
name="\${name:-world}"
echo "Hello, \${name}!"
`,
    input: 'DevCode',
  },
];

const byId = new Map(LANGUAGES.map((l) => [l.id, l]));

function getLanguage(id) {
  return byId.get(id) || null;
}

function publicList({ engine } = {}) {
  return LANGUAGES.map((l) => {
    // The Docker engine ships every toolchain in its image; only the host
    // (local engine / serverless) needs the binary installed.
    const available = engine === 'docker' || toolchains.isAvailable(l);
    return {
      id: l.id,
      name: l.name,
      monaco: l.monaco,
      ext: l.ext,
      file: l.mainFile || `main.${l.ext}`,
      starter: l.starter,
      input: l.input || '',
      available,
      note: available
        ? l.note || undefined
        : `Needs the \`${toolchains.missingTool(l)}\` toolchain, which is not installed on this host.`,
    };
  });
}

module.exports = { LANGUAGES, getLanguage, publicList };
