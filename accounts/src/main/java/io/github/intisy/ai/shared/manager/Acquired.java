package io.github.intisy.ai.shared.manager;

import io.github.intisy.ai.shared.model.Account;

/** Java analog of the JS {@code { account, access }} object returned by {@code AccountManager#acquire}. */
public class Acquired {
    /** The account selection claimed. */
    public final Account account;
    /** The claimed account's access token, ensured fresh by {@link AccountManager#acquire}. */
    public final String access;

    /**
     * @param account the account selection claimed
     * @param access the claimed account's access token
     */
    public Acquired(Account account, String access) {
        this.account = account;
        this.access = access;
    }
}
