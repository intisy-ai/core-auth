package io.github.intisy.ai.shared.rank;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class LeaderboardTest {

    private static List<Leaderboard.Score> scores(Object... pairs) {
        List<Leaderboard.Score> out = new ArrayList<>();
        for (int i = 0; i < pairs.length; i += 2) {
            out.add(new Leaderboard.Score((String) pairs[i], ((Number) pairs[i + 1]).doubleValue()));
        }
        return out;
    }

    @Test
    void normalizeDropsEffortTokensAndPunctuation() {
        assertEquals("claudeopus46", Leaderboard.normalize("claude-opus-4-6-thinking"));
        assertEquals("claude46opus", Leaderboard.normalize("Claude 4.6 Opus"));
    }

    @Test
    void everyVariantSpellingCollapsesToOneKey() {
        assertEquals("geminiflash", Leaderboard.normalize("Gemini Flash (High)"));
        assertEquals("geminiflash", Leaderboard.normalize("gemini-flash-high"));
        assertEquals("geminiflash", Leaderboard.normalize("gemini flash low"));
    }

    /** The provider label is parenthesised too, so only baseKeyFromName strips it. */
    @Test
    void baseKeyDropsEveryParentheticalTag() {
        assertEquals("claudeopusantigravity", Leaderboard.normalize("Claude Opus (High) (Antigravity)"));
        assertEquals("claudeopus", Leaderboard.baseKeyFromName("Claude Opus (High) (Antigravity)"));
    }

    @Test
    void effortRanksThinkingHighestAndPlainNamesMidRange() {
        assertEquals(6, Leaderboard.effortRank("Claude Opus (Thinking)"));
        assertEquals(5, Leaderboard.effortRank("Gemini Flash (High)"));
        assertEquals(4, Leaderboard.effortRank("Gemini Flash (Medium)"));
        assertEquals(3, Leaderboard.effortRank("Claude Opus"));
        assertEquals(2, Leaderboard.effortRank("gemini flash low"));
        assertEquals(1, Leaderboard.effortRank("Gemini Flash (Minimal)"));
    }

    /** Checked before plain "low", which would otherwise claim the same name at rank 2. */
    @Test
    void extraLowOutranksNothingAndIsNotReadAsLow() {
        assertEquals(1, Leaderboard.effortRank("Gemini Flash (Extra Low)"));
        assertEquals(1, Leaderboard.effortRank("gemini-flash-extra_low"));
    }

    @Test
    void scoreMatchesEitherWaySubstring() {
        assertEquals(50, Leaderboard.scoreForKey("geminiflash", scores("geminiflash", 50)), 1e-9);
        assertEquals(50, Leaderboard.scoreForKey("geminiflash", scores("geminiflashpro", 50)), 1e-9);
        assertEquals(50, Leaderboard.scoreForKey("geminiflashpro", scores("geminiflash", 50)), 1e-9);
    }

    @Test
    void takesTheBestOfSeveralMatches() {
        assertEquals(70, Leaderboard.scoreForKey("geminiflash", scores("geminiflash", 50, "geminiflashx", 70)), 1e-9);
    }

    /**
     * A catalog entry still ranks by its family when the score source lists only another version of
     * it, which is the whole point of the digit-stripped second pass.
     */
    @Test
    void fallsBackToTheDigitStrippedFamily() {
        assertEquals(70, Leaderboard.scoreForKey("claudeopus46", scores("claude48opus", 70)), 1e-9);
    }

    @Test
    void refusesAFamilyMatchOnAVeryShortKey() {
        assertEquals(Leaderboard.NO_SCORE, Leaderboard.scoreForKey("gpt", scores("claude48opus", 70)), 1e-9);
    }

    @Test
    void reportsNoScoreWithoutLiveData() {
        assertEquals(Leaderboard.NO_SCORE, Leaderboard.scoreForKey("claudeopus", scores()), 1e-9);
    }

    @Test
    void ordersByScoreBestFirst() {
        List<String> ids = Arrays.asList("a", "b", "c");
        List<String> names = Arrays.asList("Claude Opus", "Gemini Flash", "GPT Turbo");
        List<Leaderboard.Score> live = scores("claudeopus", 60, "geminiflash", 80, "gptturbo", 40);

        assertEquals(Arrays.asList("b", "a", "c"), Leaderboard.order(ids, names, live));
    }

    @Test
    void putsEveryScoredModelAheadOfEveryUnscoredOne() {
        List<String> ids = Arrays.asList("unscored", "scored");
        List<String> names = Arrays.asList("Totally Unknown Model", "Gemini Flash");

        assertEquals(Arrays.asList("scored", "unscored"),
                Leaderboard.order(ids, names, scores("geminiflash", 10)));
    }

    @Test
    void ordersVariantsOfOneModelByEffort() {
        List<String> ids = Arrays.asList("low", "thinking", "high");
        List<String> names = Arrays.asList("Gemini Flash (Low)", "Gemini Flash (Thinking)", "Gemini Flash (High)");

        assertEquals(Arrays.asList("thinking", "high", "low"),
                Leaderboard.order(ids, names, scores("geminiflash", 50)));
    }

    /** Effort is a within-model tie-break only: a low-effort better model still outranks a high-effort worse one. */
    @Test
    void effortNeverDecidesOrderBetweenDifferentModels() {
        List<String> ids = Arrays.asList("weakButThinking", "strongButLow");
        List<String> names = Arrays.asList("GPT Turbo (Thinking)", "Gemini Flash (Low)");

        assertEquals(Arrays.asList("strongButLow", "weakButThinking"),
                Leaderboard.order(ids, names, scores("gptturbo", 10, "geminiflash", 90)));
    }

    /**
     * The case that makes the naive comparator intransitive: two variants of one model separated in
     * the catalog by a different model. They must still come out grouped, and the sort must not
     * reject its own comparator.
     */
    @Test
    void groupsVariantsSeparatedInTheCatalogByAnotherModel() {
        List<String> ids = Arrays.asList("x-low", "y", "x-thinking");
        List<String> names = Arrays.asList("Gemini Flash (Low)", "GPT Turbo", "Gemini Flash (Thinking)");

        assertEquals(Arrays.asList("x-thinking", "x-low", "y"), Leaderboard.order(ids, names, scores()));
    }

    @Test
    void withoutLiveDataTheCatalogOrderOfDistinctModelsSurvives() {
        List<String> ids = Arrays.asList("first", "second", "third");
        List<String> names = Arrays.asList("Model A", "Model B", "Model C");

        assertEquals(ids, Leaderboard.order(ids, names, scores()));
    }

    /** A 40-entry catalog: enough that a merge sort would reject an intransitive comparator. */
    @Test
    void ordersACatalogLargeEnoughToTripTheMergeSortContractCheck() {
        List<String> ids = new ArrayList<>();
        List<String> names = new ArrayList<>();
        for (int i = 0; i < 40; i++) {
            ids.add("id" + i);
            names.add("Model " + (i % 4) + (i % 2 == 0 ? " (Thinking)" : " (Low)"));
        }

        List<String> ordered = Leaderboard.order(ids, names, scores());

        assertEquals(40, ordered.size());
        assertTrue(ordered.containsAll(ids));
    }

    @Test
    void scoresForCarriesOnlyTheIdsThatMatched() {
        Map<String, Double> expected = new LinkedHashMap<>();
        expected.put("known", Double.valueOf(50));

        assertEquals(expected, Leaderboard.scoresFor(
                Arrays.asList("known", "unknown"),
                Arrays.asList("Gemini Flash", "Totally Unknown Model"),
                scores("geminiflash", 50)));
    }

    @Test
    void idStandsInForAMissingName() {
        assertEquals(Arrays.asList("geminiflash"),
                Leaderboard.order(Arrays.asList("geminiflash"), null, scores("geminiflash", 50)));
    }

    @Test
    void sourceShortTagsLiveDataAndNothingElse() {
        assertEquals("AA", Leaderboard.sourceShort("Artificial Analysis via OpenRouter"));
        assertEquals("", Leaderboard.sourceShort(""));
        assertEquals("", Leaderboard.sourceShort(null));
    }
}
