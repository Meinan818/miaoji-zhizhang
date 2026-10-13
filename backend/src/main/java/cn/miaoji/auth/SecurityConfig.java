package cn.miaoji.auth;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.beans.factory.annotation.Value;
import java.time.Duration;

@Configuration
public class SecurityConfig {
    @Bean
    PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(12); }

    @Bean
    AuthAttemptLimiter authAttemptLimiter(@Value("${miaoji.auth.attempt-limit:20}") int limit,
            @Value("${miaoji.auth.window-seconds:60}") long seconds,
            @Value("${miaoji.auth.address-capacity:10000}") int capacity) {
        return new AuthAttemptLimiter(limit, capacity, Duration.ofSeconds(seconds), System::nanoTime);
    }

    @Bean
    SecurityFilterChain filterChain(HttpSecurity http, AuthAttemptLimiter limiter) throws Exception {
        return http
                .addFilterBefore(new AccountContextFilter(), CsrfFilter.class)
                // CSRF已验证后、密码计算前限流；filter不注册为容器Bean，避免执行两次。
                .addFilterBefore(new AuthAttemptFilter(limiter), UsernamePasswordAuthenticationFilter.class)
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/api/auth/csrf", "/api/auth/register", "/api/auth/login",
                                "/api/auth/email/code", "/api/auth/email/register").permitAll()
                        .anyRequest().authenticated())
                .requestCache(cache -> cache.disable())
                .exceptionHandling(errors -> errors
                        .authenticationEntryPoint((req, res, error) -> reply(res, 401, "UNAUTHENTICATED"))
                        .accessDeniedHandler((req, res, error) -> reply(res, 403, "FORBIDDEN")))
                .formLogin(login -> login
                        .loginProcessingUrl("/api/auth/login")
                        .successHandler((req, res, auth) -> res.setStatus(204))
                        .failureHandler((req, res, error) -> reply(res, 401, "INVALID_CREDENTIALS")))
                .logout(logout -> logout
                        .logoutUrl("/api/auth/logout")
                        .deleteCookies("MIAOJI_SESSION")
                        .logoutSuccessHandler((req, res, auth) -> res.setStatus(204)))
                // 保留默认 CSRF、登录时更换 session id、退出使 session 失效。
                .build();
    }

    private static void reply(HttpServletResponse res, int status, String code) throws IOException {
        res.setStatus(status);
        res.setContentType("application/json;charset=UTF-8");
        res.getWriter().write("{\"code\":\"" + code + "\"}");
    }
}
