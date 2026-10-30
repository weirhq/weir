//! Container language codes (ISO 639-2, bibliographic or terminologic) to
//! BCP 47 tags.

use std::collections::HashMap;
use std::sync::LazyLock;

static TABLE: LazyLock<HashMap<&'static str, &'static str>> = LazyLock::new(|| {
    let mut table = HashMap::new();
    for line in include_str!("../data/iso-639-2.txt")
        .trim_start_matches('\u{feff}')
        .lines()
    {
        let mut cols = line.trim_end_matches('\r').split('|');
        let (Some(bib), Some(term), Some(alpha2)) = (cols.next(), cols.next(), cols.next()) else {
            continue;
        };
        // BCP 47 prefers the two-letter code, then the terminologic one.
        let tag = [alpha2, term, bib]
            .into_iter()
            .find(|c| !c.is_empty())
            .unwrap_or(bib);
        table.insert(bib, tag);
        if !term.is_empty() {
            table.insert(term, tag);
        }
    }
    table
});

/// Returns the BCP 47 tag for a container language code, or an empty string
/// when the file doesn't say ("und" or nothing).
pub fn to_bcp47(code: &str) -> String {
    let code = code.trim().to_ascii_lowercase();
    if code.is_empty() || code == "und" {
        return String::new();
    }
    // Already BCP 47: a two-letter code, or a tag with subtags from MKV's
    // LanguageBCP47 element.
    if code.len() == 2 || code.contains('-') {
        return code;
    }
    TABLE
        .get(code.as_str())
        .map_or(code.clone(), |t| (*t).to_string())
}

#[cfg(test)]
mod tests {
    use super::to_bcp47;

    #[test]
    fn maps_bibliographic_and_terminologic_codes() {
        assert_eq!(to_bcp47("eng"), "en");
        assert_eq!(to_bcp47("fre"), "fr");
        assert_eq!(to_bcp47("fra"), "fr");
        assert_eq!(to_bcp47("ger"), "de");
        assert_eq!(to_bcp47("chi"), "zh");
        assert_eq!(to_bcp47("JPN"), "ja");
    }

    #[test]
    fn keeps_three_letter_codes_without_a_two_letter_form() {
        assert_eq!(to_bcp47("haw"), "haw");
        assert_eq!(to_bcp47("mul"), "mul");
    }

    #[test]
    fn passes_bcp47_through_and_drops_undetermined() {
        assert_eq!(to_bcp47("pt-br"), "pt-br");
        assert_eq!(to_bcp47("en"), "en");
        assert_eq!(to_bcp47("und"), "");
        assert_eq!(to_bcp47(""), "");
    }
}
