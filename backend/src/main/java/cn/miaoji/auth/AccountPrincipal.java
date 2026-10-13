package cn.miaoji.auth;

import java.util.List;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.User;

public final class AccountPrincipal extends User {
    private final long id;

    public AccountPrincipal(long id, String username, String passwordHash) {
        super(username, passwordHash, List.of(new SimpleGrantedAuthority("ROLE_USER")));
        this.id = id;
    }

    public long id() { return id; }
}
