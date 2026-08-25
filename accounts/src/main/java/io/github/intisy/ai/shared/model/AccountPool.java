package io.github.intisy.ai.shared.model;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The JS {@code AccountPool} (see {@code libs/core-auth/src/types.ts}) in Java. Field order is
 * the serialized key order, which a JS reader of the same file depends on.
 */
public class AccountPool {
    public List<Account> accounts;
    public int activeIndex;                          // sticky selection when no lane is given
    public Map<String, Integer> activeIndexByLane;

    public AccountPool() {
        this.accounts = new ArrayList<>();
        this.activeIndex = 0;
        this.activeIndexByLane = new LinkedHashMap<>();
    }

    public AccountPool(List<Account> accounts, int activeIndex, Map<String, Integer> activeIndexByLane) {
        this.accounts = accounts != null ? accounts : new ArrayList<>();
        this.activeIndex = activeIndex;
        this.activeIndexByLane = activeIndexByLane != null ? activeIndexByLane : new LinkedHashMap<>();
    }
}
