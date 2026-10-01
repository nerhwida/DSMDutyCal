// 한글 초성 검색 (예: 'ㄱㅁ' → '김민수', 'ㄱ민' → '김민수').

const CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const SYLLABLE_START = 0xac00;
const SYLLABLE_END = 0xd7a3;

/** 한글 음절의 초성 ('김' → 'ㄱ'). 음절이 아니면 null. */
function choseongOf(ch: string): string | null {
  const code = ch.charCodeAt(0);
  if (code < SYLLABLE_START || code > SYLLABLE_END) return null;
  return CHOSEONG[Math.floor((code - SYLLABLE_START) / 588)];
}

/** 검색어 한 글자가 이름 한 글자와 맞는지. 초성 자음이면 초성끼리, 아니면 글자 그대로 비교한다. */
function charMatches(q: string, ch: string): boolean {
  if (CHOSEONG.includes(q)) return choseongOf(ch) === q;
  return q === ch;
}

/** 이름에 검색어가 이어서 나타나는지 (초성·완성 글자 섞어 쓰기 가능). 빈 검색어는 모두 일치. */
export function matchesHangul(name: string, query: string): boolean {
  const q = query.replace(/\s/g, '');
  if (!q) return true;
  for (let start = 0; start + q.length <= name.length; start++) {
    let ok = true;
    for (let i = 0; i < q.length; i++) {
      if (!charMatches(q[i], name[start + i])) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}
