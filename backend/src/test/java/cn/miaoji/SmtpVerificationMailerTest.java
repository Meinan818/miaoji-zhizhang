package cn.miaoji;

import cn.miaoji.auth.SmtpVerificationMailer;
import cn.miaoji.common.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.MailAuthenticationException;
import org.springframework.mail.javamail.JavaMailSender;
import org.mockito.ArgumentCaptor;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class SmtpVerificationMailerTest {
    @Test void disabledOrMissingCredentialsNeverContactsSmtp() {
        var mail=mock(JavaMailSender.class);
        var disabled=new SmtpVerificationMailer(mail,false,"synthetic@example.test","synthetic-auth");
        assertThatThrownBy(()->disabled.send("recipient@example.test","123456")).isInstanceOf(ApiException.class);
        var missing=new SmtpVerificationMailer(mail,true,"synthetic@example.test","");
        assertThatThrownBy(()->missing.send("recipient@example.test","123456")).isInstanceOf(ApiException.class);
        verifyNoInteractions(mail);
    }
    @Test void mailTargetsOnlyGivenRecipientAndDoesNotExposeAuthenticationErrors() {
        var mail=mock(JavaMailSender.class);
        var sender=new SmtpVerificationMailer(mail,true,"synthetic@example.test","synthetic-auth");
        sender.send("recipient@example.test","123456");
        var capture=ArgumentCaptor.forClass(SimpleMailMessage.class);verify(mail).send(capture.capture());
        assertThat(capture.getValue().getTo()).containsExactly("recipient@example.test");
        assertThat(capture.getValue().getText()).contains("123456","5分钟").doesNotContain("synthetic-auth");
        doThrow(new MailAuthenticationException("synthetic-secret must never escape")).when(mail).send(any(SimpleMailMessage.class));
        assertThatThrownBy(()->sender.send("recipient@example.test","123456"))
                .isInstanceOf(ApiException.class).hasMessage("验证码邮件暂时无法发送，请稍后再试");
    }
}
