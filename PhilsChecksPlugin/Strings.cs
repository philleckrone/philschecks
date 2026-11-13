using System;

namespace PhilsChecks
{
    public enum Lang { English, Spanish, French }

    /// <summary>
    /// The window's text in English, Spanish or French, picked from Paratext's interface language.
    /// Keep this file ASCII: run tools\asciify_cs.py after typing accented letters.
    /// </summary>
    public sealed class Strings
    {
        /// <summary>The tool's version: shown in the window title and reported to Paratext.</summary>
        public const string ToolVersion = "1.6";

        public Lang Language;
        public string MenuText;
        public string Title;
        public string Description;
        public string Intro;
        public string ChecksLanguage;
        public string English;
        public string Spanish;
        public string French_;
        public string ColCheck;
        public string ColKind;
        public string KindReport;
        public string KindChanges;
        public string EnglishOnly;
        public string RunButton;
        public string HelpButton;
        public string CloseButton;
        public string Count;
        public string NoHelp;
        public string OpenProjectFirst;
        public string Error;
        public string NotSupported;
        public string BundleProblem;
        public string NoCheckChosen;
        public string OpenElsewhere;
        public string CannotOpenElsewhere;

        /// <summary>The texts of the help viewer (1.5).</summary>
        public PhilsShared.RtfViewer.Texts Viewer()
        {
            var t = new PhilsShared.RtfViewer.Texts();
            t.OpenElsewhere = OpenElsewhere;
            t.Close = CloseButton;
            t.CannotOpenElsewhere = CannotOpenElsewhere;
            return t;
        }

        public static Lang LanguageOf(string locale)
        {
            if (string.IsNullOrEmpty(locale)) return Lang.English;
            string l = locale.ToLowerInvariant();
            if (l.StartsWith("es")) return Lang.Spanish;
            if (l.StartsWith("fr")) return Lang.French;
            return Lang.English;
        }

        public static Strings For(string locale)
        {
            return For(LanguageOf(locale));
        }

        public static Strings For(Lang lang)
        {
            switch (lang)
            {
                case Lang.Spanish: return Spanish_();
                case Lang.French: return French();
                default: return English_();
            }
        }

        public static Strings English_()
        {
            var s = new Strings();
            s.Language = Lang.English;
            s.MenuText = "Phils Custom (cms) Checks...";
            s.Title = "Phils Custom (cms) Checks";
            s.Description = "Lists Phil's custom checks and runs the one you choose, without copying them into the cms folder.";
            s.Intro = "Choose a check and click Run. Paratext's own check window then asks for the books and options, and shows the results as usual.";
            s.ChecksLanguage = "Language of the checks:";
            s.English = "English";
            s.Spanish = "Spanish";
            s.French_ = "French";
            s.ColCheck = "Check";
            s.ColKind = "Kind";
            s.KindReport = "Report";
            s.KindChanges = "Changes text";
            s.EnglishOnly = "(English only)";
            s.RunButton = "Run...";
            s.HelpButton = "Help";
            s.CloseButton = "Close";
            s.Count = "{0} checks";
            s.NoHelp = "This check has no help file.";
            s.OpenProjectFirst = "Open a project's text window first, then choose Tools > Phils Custom (cms) Checks... again.";
            s.Error = "Something went wrong: {0}";
            s.NotSupported = "This version of Paratext is not supported by Phils Custom (cms) Checks, so nothing was run.\n\nDetails: {0}";
            s.BundleProblem = "The checks could not be prepared in {0}.\n\n{1}";
            s.NoCheckChosen = "Choose a check first.";
            s.OpenElsewhere = "Open in another program";
            s.CannotOpenElsewhere = "Windows could not open the file in another program: {0}";
            return s;
        }

        public static Strings Spanish_()
        {
            var s = new Strings();
            s.Language = Lang.Spanish;
            s.MenuText = "Verificaciones personalizadas (cms) de Phil...";
            s.Title = "Verificaciones personalizadas (cms) de Phil";
            s.Description = "Muestra las verificaciones personalizadas de Phil y ejecuta la que usted elija, sin copiarlas a la carpeta cms.";
            s.Intro = "Elija una verificaci\u00F3n y haga clic en Ejecutar. La ventana de verificaci\u00F3n de Paratext pide entonces los libros y las opciones, y muestra los resultados como siempre.";
            s.ChecksLanguage = "Idioma de las verificaciones:";
            s.English = "Ingl\u00E9s";
            s.Spanish = "Espa\u00F1ol";
            s.French_ = "Franc\u00E9s";
            s.ColCheck = "Verificaci\u00F3n";
            s.ColKind = "Tipo";
            s.KindReport = "Informe";
            s.KindChanges = "Cambia el texto";
            s.EnglishOnly = "(solo en ingl\u00E9s)";
            s.RunButton = "Ejecutar...";
            s.HelpButton = "Ayuda";
            s.CloseButton = "Cerrar";
            s.Count = "{0} verificaciones";
            s.NoHelp = "Esta verificaci\u00F3n no tiene archivo de ayuda.";
            s.OpenProjectFirst = "Abra primero la ventana de texto de un proyecto y elija de nuevo Herramientas > Verificaciones personalizadas (cms) de Phil...";
            s.Error = "Algo sali\u00F3 mal: {0}";
            s.NotSupported = "Esta versi\u00F3n de Paratext no es compatible con Verificaciones personalizadas (cms) de Phil, as\u00ED que no se ejecut\u00F3 nada.\n\nDetalles: {0}";
            s.BundleProblem = "No se pudieron preparar las verificaciones en {0}.\n\n{1}";
            s.NoCheckChosen = "Elija primero una verificaci\u00F3n.";
            s.OpenElsewhere = "Abrir con otro programa";
            s.CannotOpenElsewhere = "Windows no pudo abrir el archivo con otro programa: {0}";
            return s;
        }

        public static Strings French()
        {
            var s = new Strings();
            s.Language = Lang.French;
            s.MenuText = "V\u00E9rifications personnalis\u00E9es (cms) de Phil...";
            s.Title = "V\u00E9rifications personnalis\u00E9es (cms) de Phil";
            s.Description = "Affiche les v\u00E9rifications personnalis\u00E9es de Phil et ex\u00E9cute celle que vous choisissez, sans les copier dans le dossier cms.";
            s.Intro = "Choisissez une v\u00E9rification et cliquez sur Ex\u00E9cuter. La fen\u00EAtre de v\u00E9rification de Paratext demande alors les livres et les options, et affiche les r\u00E9sultats comme d'habitude.";
            s.ChecksLanguage = "Langue des v\u00E9rifications :";
            s.English = "Anglais";
            s.Spanish = "Espagnol";
            s.French_ = "Fran\u00E7ais";
            s.ColCheck = "V\u00E9rification";
            s.ColKind = "Type";
            s.KindReport = "Rapport";
            s.KindChanges = "Modifie le texte";
            s.EnglishOnly = "(en anglais seulement)";
            s.RunButton = "Ex\u00E9cuter...";
            s.HelpButton = "Aide";
            s.CloseButton = "Fermer";
            s.Count = "{0} v\u00E9rifications";
            s.NoHelp = "Cette v\u00E9rification n'a pas de fichier d'aide.";
            s.OpenProjectFirst = "Ouvrez d'abord la fen\u00EAtre de texte d'un projet, puis choisissez \u00E0 nouveau Outils > V\u00E9rifications personnalis\u00E9es (cms) de Phil...";
            s.Error = "Une erreur s'est produite : {0}";
            s.NotSupported = "Cette version de Paratext n'est pas prise en charge par V\u00E9rifications personnalis\u00E9es (cms) de Phil ; rien n'a \u00E9t\u00E9 ex\u00E9cut\u00E9.\n\nD\u00E9tails : {0}";
            s.BundleProblem = "Les v\u00E9rifications n'ont pas pu \u00EAtre pr\u00E9par\u00E9es dans {0}.\n\n{1}";
            s.NoCheckChosen = "Choisissez d'abord une v\u00E9rification.";
            s.OpenElsewhere = "Ouvrir avec un autre programme";
            s.CannotOpenElsewhere = "Windows n'a pas pu ouvrir le fichier avec un autre programme : {0}";
            return s;
        }
    }
}
