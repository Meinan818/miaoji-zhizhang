package cn.miaoji.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.web.filter.OncePerRequestFilter;

public class AuthAttemptFilter extends OncePerRequestFilter {
    private final AuthAttemptLimiter limiter;
    public AuthAttemptFilter(AuthAttemptLimiter limiter) { this.limiter = limiter; }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        var path = request.getRequestURI();
        return !request.getMethod().equals("POST") || !(path.equals(request.getContextPath() + "/api/auth/login")
                || path.equals(request.getContextPath() + "/api/auth/register")
                || path.equals(request.getContextPath() + "/api/auth/email/code")
                || path.equals(request.getContextPath() + "/api/auth/email/register"));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        // 不信任客户端可伪造的X-Forwarded-For；反向代理可信配置另在部署阶段确认。
        long wait = limiter.acquire(request.getRemoteAddr());
        if (wait == 0) { chain.doFilter(request, response); return; }
        response.setStatus(429);
        response.setHeader("Retry-After", Long.toString(wait));
        response.setHeader("Cache-Control", "no-store");
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"code\":\"AUTH_RATE_LIMITED\",\"message\":\"登录或注册尝试较多，请稍后再试。\"}");
    }
}
