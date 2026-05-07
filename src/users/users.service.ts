import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../database/database.module';
import { profiles, type Profile } from '../database/schema/profiles';

export type ProfileWithRole = Profile & {
  email: string;
  role: 'admin' | 'user';
};

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
  ) {}

  async getOrCreateProfile(userId: string, email: string): Promise<ProfileWithRole> {
    const [existing] = await this.db
      .select()
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    let profile = existing;
    if (!profile) {
      const fallbackName = email.split('@')[0] ?? 'friend';
      [profile] = await this.db
        .insert(profiles)
        .values({ id: userId, name: fallbackName })
        .returning();
    }

    return {
      ...profile,
      email,
      role: this.isAdmin(email) ? 'admin' : 'user',
    };
  }

  async acceptDisclaimer(userId: string): Promise<void> {
    await this.db
      .update(profiles)
      .set({ disclaimerAcceptedAt: new Date(), updatedAt: new Date() })
      .where(eq(profiles.id, userId));
  }

  async updateName(userId: string, email: string, name: string): Promise<ProfileWithRole> {
    const [updated] = await this.db
      .update(profiles)
      .set({ name, updatedAt: new Date() })
      .where(eq(profiles.id, userId))
      .returning();

    return {
      ...updated,
      email,
      role: this.isAdmin(email) ? 'admin' : 'user',
    };
  }

  private isAdmin(email: string): boolean {
    const allowlist = this.config.getOrThrow<string[]>('ADMIN_EMAILS');
    return allowlist.includes(email.toLowerCase());
  }
}
