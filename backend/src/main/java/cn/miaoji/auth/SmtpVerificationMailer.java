package cn.miaoji.auth;

import cn.miaoji.common.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.mail.MailException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;

@Service
public class SmtpVerificationMailer implements VerificationMailer {
    private final JavaMailSender mail;
    private final boolean enabled;
    private final String sender;
    private final String authorization;
    public SmtpVerificationMailer(JavaMailSender mail,@Value("${miaoji.email.enabled:false}") boolean enabled,
            @Value("${spring.mail.username:}") String sender,@Value("${spring.mail.password:}") String authorization) {
        this.mail=mail;this.enabled=enabled;this.sender=sender;this.authorization=authorization;
    }
    @Override public void send(String recipient,String code) {
        if(!enabled || sender.isBlank() || authorization.isBlank()) throw unavailable();
        var message=new SimpleMailMessage();message.setFrom(sender);message.setTo(recipient);
        message.setSubject("喵叽智账 · 注册验证码");
        message.setText("你的注册验证码是："+code+"\n5分钟内有效。请勿转发给他人。\n如果不是你本人申请，请忽略此邮件。");
        try { mail.send(message); }
        catch(MailException failure) { throw unavailable(); } // 不输出收件人、验证码或SMTP认证异常原文。
    }
    private ApiException unavailable() {
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"MAIL_UNAVAILABLE","验证码邮件暂时无法发送，请稍后再试");
    }
}
