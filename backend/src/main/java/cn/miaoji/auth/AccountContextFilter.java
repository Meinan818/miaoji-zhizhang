package cn.miaoji.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

public class AccountContextFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        var expected = request.getHeader("X-Expected-Account");
        if (expected == null && request.getRequestURI().equals("/api/profile/avatar")) expected = request.getParameter("expectedAccount");
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (expected != null && authentication != null && authentication.getPrincipal() instanceof AccountPrincipal owner
                && !Long.toString(owner.id()).equals(expected)) {
            // 仅断言页面身份未变；权限和归属始终由真正会话决定。
            response.setStatus(409);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\":\"ACCOUNT_CHANGED\",\"message\":\"登录账号已变化，请重新打开账本\"}");
            return;
        }
        chain.doFilter(request, response);
    }
}
