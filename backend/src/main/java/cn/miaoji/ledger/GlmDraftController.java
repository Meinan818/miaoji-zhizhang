package cn.miaoji.ledger;

import cn.miaoji.auth.AccountPrincipal;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/ai")
public class GlmDraftController {
    private final GlmDraftParser parser;
    public GlmDraftController(GlmDraftParser parser) {this.parser=parser;}
    @PostMapping("/parse")
    public ResponseEntity<GlmDraftParser.Proposal> parse(@AuthenticationPrincipal AccountPrincipal user,
            @RequestBody GlmDraftParser.Input input) {
        return ResponseEntity.ok().header("Cache-Control","no-store").body(parser.parse(user.id(),input));
    }
}
