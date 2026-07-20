/// Normalize OCR whitespace without destroying legitimate Latin word spacing.
///
/// WinRT may insert spaces between individually recognized CJK words. We first
/// collapse arbitrary whitespace, then remove a space only when both adjacent
/// characters are CJK characters or CJK punctuation.
pub fn normalize_ocr_spacing(text: &str) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return collapsed;
    }

    let chars: Vec<char> = collapsed.chars().collect();
    let mut result = String::with_capacity(collapsed.len());
    let mut previous_is_cjk = false;

    for (index, &ch) in chars.iter().enumerate() {
        if ch == ' ' && previous_is_cjk {
            let next_is_cjk = chars[index + 1..]
                .iter()
                .find(|next| !next.is_whitespace())
                .is_some_and(|next| is_cjk(*next));
            if next_is_cjk {
                continue;
            }
        }
        previous_is_cjk = is_cjk(ch);
        result.push(ch);
    }

    result
}

fn is_cjk(ch: char) -> bool {
    matches!(ch,
        '\u{4E00}'..='\u{9FFF}'   | // CJK Unified Ideographs
        '\u{3400}'..='\u{4DBF}'   | // CJK Extension A
        '\u{F900}'..='\u{FAFF}'   | // CJK Compatibility Ideographs
        '\u{3040}'..='\u{309F}'   | // Hiragana
        '\u{30A0}'..='\u{30FF}'   | // Katakana
        '\u{3000}'..='\u{303F}'   | // CJK symbols and punctuation
        '\u{FF00}'..='\u{FFEF}'     // Full-width forms
    )
}

#[cfg(test)]
mod tests {
    use super::normalize_ocr_spacing;

    #[test]
    fn removes_chinese_inter_word_spaces() {
        assert_eq!(normalize_ocr_spacing("你 好 ， 世 界 ！"), "你好，世界！");
    }

    #[test]
    fn removes_japanese_inter_word_spaces() {
        assert_eq!(
            normalize_ocr_spacing("こ ん に ち は 、 世 界"),
            "こんにちは、世界"
        );
    }

    #[test]
    fn preserves_latin_word_spaces() {
        assert_eq!(
            normalize_ocr_spacing("  hello   brave\nnew world  "),
            "hello brave new world"
        );
    }

    #[test]
    fn preserves_mixed_language_boundaries() {
        assert_eq!(
            normalize_ocr_spacing("Player 说: 你 好 world 2"),
            "Player 说: 你好 world 2"
        );
    }
}
