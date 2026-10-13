package cn.miaoji.profile;

import cn.miaoji.auth.AccountPrincipal;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/profile")
public class ProfileController {
    private final ProfileService profiles;
    public ProfileController(ProfileService profiles) { this.profiles = profiles; }

    @GetMapping
    public ProfileService.ProfileView get(@AuthenticationPrincipal AccountPrincipal user) { return profiles.read(user.id()); }

    @PutMapping
    public ProfileService.ProfileView put(@AuthenticationPrincipal AccountPrincipal user, @Valid @RequestBody ProfileService.ProfileInput input) {
        return profiles.update(user.id(), input);
    }

    @PostMapping(value = "/avatar", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ProfileService.ProfileView upload(@AuthenticationPrincipal AccountPrincipal user, @RequestParam long version,
            @RequestPart("image") MultipartFile photo) {
        return profiles.upload(user.id(), version, photo);
    }

    @GetMapping("/avatar")
    public ResponseEntity<byte[]> avatar(@AuthenticationPrincipal AccountPrincipal user) {
        return ResponseEntity.ok().contentType(MediaType.IMAGE_JPEG).cacheControl(CacheControl.noStore()).body(profiles.avatar(user.id()));
    }
}
