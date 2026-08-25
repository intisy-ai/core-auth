package io.github.intisy.ai.shared.store;

import io.github.intisy.ai.shared.model.Account;
import io.github.intisy.ai.api.seam.JsonCodec;
import io.github.intisy.ai.api.seam.Store;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import io.github.intisy.ai.seam.SimpleJsonCodec;
import io.github.intisy.ai.seam.InMemoryStore;

class AccountStoreTest {

    @Test
    void addListAndUpsertRoundTripExactJsonShape() {
        Store store = new InMemoryStore();
        JsonCodec json = new SimpleJsonCodec();
        AccountStore s = new AccountStore(store, json);

        Account a = new Account();
        a.id = "acc1";
        a.refresh = "r1";
        a.enabled = true;
        s.add("claude-code", a);

        assertEquals(1, s.list("claude-code").size());

        String raw = store.get("accounts.json");
        assertNotNull(raw);
        assertTrue(raw.contains("\"version\""));
        assertTrue(raw.contains("\"providers\"") && raw.contains("\"claude-code\""));

        Account a2 = new Account();
        a2.id = "acc1";
        a2.refresh = "r1b";
        s.add("claude-code", a2); // upsert by id

        assertEquals(1, s.list("claude-code").size());
        assertEquals("r1b", s.list("claude-code").get(0).refresh);
    }

    @Test
    void addUpsertsByRefreshWhenIdDiffersOrMissing() {
        Store store = new InMemoryStore();
        AccountStore s = new AccountStore(store, new SimpleJsonCodec());

        Account a = new Account();
        a.refresh = "same-refresh";
        a.email = "old@example.com";
        s.add("prov", a);

        Account a2 = new Account();
        a2.refresh = "same-refresh";
        a2.email = "new@example.com";
        s.add("prov", a2);

        assertEquals(1, s.list("prov").size());
        assertEquals("new@example.com", s.list("prov").get(0).email);
    }

    @Test
    void removeDropsAccountById() {
        Store store = new InMemoryStore();
        AccountStore s = new AccountStore(store, new SimpleJsonCodec());

        Account a = new Account();
        a.id = "acc1";
        s.add("prov", a);
        assertEquals(1, s.list("prov").size());

        s.remove("prov", "acc1");
        assertEquals(0, s.list("prov").size());
    }

    /**
     * Locks numeric fidelity: a whole-number {@code meta} entry (e.g. a lane's remaining-quota
     * count) must round-trip through the store WITHOUT gaining a spurious trailing {@code .0},
     * while a genuinely fractional entry (e.g. {@code remainingFraction}) must still serialize
     * as a JSON double. In shared code this means building whole numbers as {@code Long}/
     * {@code Integer} (not {@code Double}) so the codec sees the right type.
     */
    @Test
    void meta_wholeNumberSurvivesRoundTripWithoutTrailingZero() {
        Store store = new InMemoryStore();
        AccountStore s = new AccountStore(store, new SimpleJsonCodec());

        Account a = new Account();
        a.id = "acc-meta";
        a.refresh = "r-meta";
        a.enabled = true;
        a.meta = new LinkedHashMap<>();
        a.meta.put("count", 5L);
        a.meta.put("remainingFraction", 0.5);
        s.add("meta-provider", a);

        Account roundTripped = s.list("meta-provider").get(0);
        assertEquals(5.0, ((Number) roundTripped.meta.get("count")).doubleValue());
        assertEquals(0.5, ((Number) roundTripped.meta.get("remainingFraction")).doubleValue());

        String raw = store.get("accounts.json");
        assertTrue(raw.contains("\"count\":5"));
        assertFalse(raw.contains("\"count\":5.0"));
        assertTrue(raw.contains("\"remainingFraction\":0.5"));
    }

    /**
     * The store is byte-compatible with a JS writer that keeps whatever it was given, so a field
     * outside the declared {@link Account} shape must survive a read-modify-write instead of being
     * narrowed away.
     */
    @Test
    void upsert_keepsFieldsOutsideTheDeclaredAccountShape() {
        Store store = new InMemoryStore();
        store.put("accounts.json",
                "{\"version\":1,\"providers\":{\"prov\":{\"accounts\":["
                        + "{\"id\":\"acc1\",\"refresh\":\"r1\",\"vendorOnly\":\"keep-me\"}"
                        + "],\"activeIndex\":0,\"activeIndexByLane\":{}}}}");
        AccountStore s = new AccountStore(store, new SimpleJsonCodec());

        Map<String, Object> incoming = new LinkedHashMap<>();
        incoming.put("id", "acc1");
        incoming.put("access", "tok");
        assertEquals(AccountStore.Upsert.UPDATED, s.upsertRaw("prov", incoming));

        assertTrue(store.get("accounts.json").contains("\"vendorOnly\":\"keep-me\""));
    }

    @Test
    void upsert_reportsAddedThenUpdatedThenUnchanged() {
        Store store = new InMemoryStore();
        AccountStore s = new AccountStore(store, new SimpleJsonCodec());

        Map<String, Object> account = new LinkedHashMap<>();
        account.put("id", "acc1");
        account.put("refresh", "r1");

        assertEquals(AccountStore.Upsert.ADDED, s.upsertRaw("prov", account));
        assertEquals(AccountStore.Upsert.UNCHANGED, s.upsertRaw("prov", account));

        Map<String, Object> changed = new LinkedHashMap<>();
        changed.put("id", "acc1");
        changed.put("email", "someone@example.com");
        assertEquals(AccountStore.Upsert.UPDATED, s.upsertRaw("prov", changed));
    }

    /**
     * A login refresh re-upserts the same account on every call, so an object-valued field whose
     * keys arrive in a different order must not read as a change; array order IS content.
     */
    @Test
    void upsert_isUnchangedForAReorderedObjectButUpdatedForAReorderedArray() {
        Store store = new InMemoryStore();
        AccountStore s = new AccountStore(store, new SimpleJsonCodec());

        Map<String, Object> firstMeta = new LinkedHashMap<>();
        firstMeta.put("a", 1L);
        firstMeta.put("b", 2L);
        Map<String, Object> first = new LinkedHashMap<>();
        first.put("id", "acc1");
        first.put("meta", firstMeta);
        first.put("lanes", Arrays.asList("x", "y"));
        s.upsertRaw("prov", first);

        Map<String, Object> reorderedMeta = new LinkedHashMap<>();
        reorderedMeta.put("b", 2L);
        reorderedMeta.put("a", 1L);
        Map<String, Object> reordered = new LinkedHashMap<>();
        reordered.put("id", "acc1");
        reordered.put("meta", reorderedMeta);
        reordered.put("lanes", Arrays.asList("x", "y"));
        assertEquals(AccountStore.Upsert.UNCHANGED, s.upsertRaw("prov", reordered));

        Map<String, Object> swappedLanes = new LinkedHashMap<>();
        swappedLanes.put("id", "acc1");
        swappedLanes.put("meta", reorderedMeta);
        swappedLanes.put("lanes", Arrays.asList("y", "x"));
        assertEquals(AccountStore.Upsert.UPDATED, s.upsertRaw("prov", swappedLanes));
    }

    @Test
    void remove_reportsWhetherAnAccountWasThere() {
        Store store = new InMemoryStore();
        AccountStore s = new AccountStore(store, new SimpleJsonCodec());

        Account a = new Account();
        a.id = "acc1";
        s.add("prov", a);

        assertTrue(s.removeRaw("prov", "acc1"));
        assertFalse(s.removeRaw("prov", "acc1"));
    }

    @Test
    void loadRaw_defaultsThePoolFieldsAndSaveRawLeavesOtherProvidersAlone() {
        Store store = new InMemoryStore();
        AccountStore s = new AccountStore(store, new SimpleJsonCodec());

        Account other = new Account();
        other.id = "keep";
        s.add("other-prov", other);

        String empty = s.loadRaw("prov");
        assertTrue(empty.contains("\"accounts\":[]"));
        assertTrue(empty.contains("\"activeIndex\":0"));
        assertTrue(empty.contains("\"activeIndexByLane\":{}"));

        s.saveRaw("prov", "{\"accounts\":[{\"id\":\"acc1\"}],\"activeIndex\":3}");

        assertEquals(1, s.list("prov").size());
        assertEquals(3, s.load("prov").activeIndex);
        assertEquals(1, s.list("other-prov").size());
    }

    /**
     * Best-effort read resilience (JS/core parity): a corrupted {@code accounts.json} must
     * degrade to an empty pool rather than throwing out of {@code list}/{@code load}.
     */
    @Test
    void list_returnsEmptyPoolWhenStoreContainsMalformedJson() {
        Store store = new InMemoryStore();
        store.put("accounts.json", "{ not json");
        AccountStore s = new AccountStore(store, new SimpleJsonCodec());

        assertTrue(s.list("claude-code").isEmpty());
    }
}
