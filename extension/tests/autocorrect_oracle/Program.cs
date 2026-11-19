// The AutoCorrect Editor's own file code (linked from AutoCorrect\AutoCorrectEditor), as an oracle
// for tests/compare_tools.py ac: reads an autocorrect.txt and writes it back as the editor saves it.
//   AutoCorrectOracle.exe IN.txt OUT.txt    prints "ENTRIES n HEADER m"
using System;
using System.Collections.Generic;
using AutoCorrectEditor.Services;

internal static class Program
{
    private static int Main(string[] args)
    {
        List<string> header;
        var entries = AutoCorrectFileService.Read(args[0], out header);
        AutoCorrectFileService.Write(args[1], entries, header);
        Console.WriteLine("ENTRIES " + entries.Count + " HEADER " + header.Count);
        return 0;
    }
}
